import {
  ActionFlags,
  Actions,
  BaseKind,
  CodeAction,
  Command,
  Context,
  CreateFile,
  DduItem,
  DeleteFile,
  Denops,
  dirname,
  existsSync,
  fn,
  fromA,
  fromFileUrl,
  jsdiff,
  op,
  PreviewContext,
  Previewer,
  relative,
  RenameFile,
  TextDocumentEdit,
  TextEdit,
  WorkspaceEdit,
  wrapA,
} from "../ddu_source_lsp/deps.ts";
import { ItemContext } from "./lsp.ts";
import {
  bufNrToPath,
  byteLength,
  isPositionBefore,
  pick,
  uriToBufNr,
  uriToPath,
} from "../ddu_source_lsp/util.ts";
import * as vim from "../ddu_source_lsp/vim.ts";
import {
  decodeUtfPosition,
  OffsetEncoding,
  toUtf16Position,
} from "../ddu_source_lsp/offset_encoding.ts";
import { lspRequest } from "../ddu_source_lsp/request.ts";

export type ActionData = {
  edit?: WorkspaceEdit;
  command?: Command;
  context: Omit<ItemContext, "method">;
  resolved?: boolean;
};

async function ensureAction(
  denops: Denops,
  item: DduItem,
): Promise<ActionData> {
  const action = item.action as ActionData;
  if (!action) {
    throw new Error(`Invalid usage of kind-lsp_codeAction`);
  }

  if (!action.resolved && action.edit === undefined) {
    try {
      const resolvedCodeAction = await lspRequest(
        denops,
        action.context.client,
        "codeAction/resolve",
        item.data,
        action.context.bufNr,
      ) as CodeAction | null;
      action.edit = resolvedCodeAction?.edit;
    } finally {
      action.resolved = true;
    }
  }

  return action;
}

type Params = Record<never, never>;

export class Kind extends BaseKind<Params> {
  override actions: Actions<Params> = {
    apply: async (args: {
      denops: Denops;
      context: Context;
      items: DduItem[];
    }) => {
      if (args.items.length !== 1) {
        console.log(`Apply should be called on a single item.`);
        return ActionFlags.Persist;
      }
      const action = await ensureAction(args.denops, args.items[0]);

      if (action.edit) {
        await applyWorkspaceEdit(args.denops, action.edit, action.context.client.offsetEncoding);
      }
      if (action.command) {
        await lspRequest(
          args.denops,
          action.context.client,
          "workspace/executeCommand",
          pick(action.command, "command", "arguments"),
          action.context.bufNr,
        );
      }

      return ActionFlags.None;
    },
  };

  override async getPreviewer(args: {
    denops: Denops;
    item: DduItem;
    actionParams: unknown;
    previewContext: PreviewContext;
  }): Promise<Previewer | undefined> {
    const { denops } = args;
    const action = await ensureAction(denops, args.item);
    const offsetEncoding = action.context.client.offsetEncoding;

    if (action.edit) {
      if (action.edit.documentChanges) {
        const patch = await wrapA(fromA(action.edit.documentChanges))
          .map(async (change) => {
            if (!("kind" in change)) {
              return await createPatchFromTextDocumentEdit(
                denops,
                change,
                action.context.client.offsetEncoding,
              );
            } else if (change.kind === "create") {
              const path = relative(Deno.cwd(), fromFileUrl(change.uri));
              return [
                `diff --code-action a/${path} b/${path}`,
                "new file",
                "--- /dev/null",
                `+++ b/${path}`,
              ];
            } else if (change.kind === "rename") {
              const oldPath = relative(Deno.cwd(), fromFileUrl(change.oldUri));
              const newPath = relative(Deno.cwd(), fromFileUrl(change.newUri));
              return [
                `diff --code-action a/${oldPath} b/${newPath}`,
                `rename from ${oldPath}`,
                `rename to ${newPath}`,
              ];
            } else if (change.kind === "delete") {
              const path = relative(Deno.cwd(), fromFileUrl(change.uri));
              return [
                `diff --code-action a/${path} b/${path}`,
                "deleted file",
                `--- a/${path}`,
                "+++ /dev/null",
              ];
            } else {
              change satisfies never;
              throw new Error("Invalid documentChanges");
            }
          })
          .reduce((acc, patch) => [...acc, ...patch, ""], [] as string[]);

        return {
          kind: "nofile",
          contents: patch,
          syntax: "diff",
        };
      } else if (action.edit.changes) {
        const patch = await wrapA(fromA(Object.entries(action.edit.changes)))
          .map(async ([uri, textEdits]) => {
            const bufNr = await uriToBufNr(denops, uri);
            return await createPatchFromTextEdit(denops, textEdits, bufNr, offsetEncoding);
          })
          .reduce((acc, patch) => [...acc, ...patch, ""], [] as string[]);

        return {
          kind: "nofile",
          contents: patch,
          syntax: "diff",
        };
      }
    } else if (action.command) {
      return {
        kind: "nofile",
        contents: [`Command: ${action.command.title} (${action.command.command})`],
      };
    }
  }

  override params(): Params {
    return {};
  }
}

async function applyWorkspaceEdit(
  denops: Denops,
  workspaceEdit: WorkspaceEdit,
  offsetEncoding?: OffsetEncoding,
) {
  if (workspaceEdit.documentChanges) {
    for (const change of workspaceEdit.documentChanges) {
      if (!("kind" in change)) {
        await applyTextDocumentEdit(denops, change, offsetEncoding);
      } else if (change.kind === "create") {
        await createFile(denops, change);
      } else if (change.kind === "rename") {
        await renameFile(denops, change);
      } else if (change.kind === "delete") {
        await deleteFile(denops, change);
      } else {
        change satisfies never;
      }
    }
    return;
  }

  if (workspaceEdit.changes) {
    for (const [uri, textEdits] of Object.entries(workspaceEdit.changes)) {
      const bufNr = await uriToBufNr(denops, uri);
      await applyTextEdit(denops, textEdits, bufNr, offsetEncoding);
    }
  }
}

async function createFile(
  denops: Denops,
  change: CreateFile,
) {
  const path = uriToPath(change.uri);
  if (!existsSync(path) || (change.options?.overwrite || !change.options?.ignoreIfExists)) {
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.create(path);
  }
  await fn.bufadd(denops, path);
}

async function renameFile(
  denops: Denops,
  change: RenameFile,
) {
  const oldPath = uriToPath(change.oldUri);
  const newPath = uriToPath(change.newUri);

  if (existsSync(newPath)) {
    if (!change.options?.overwrite || change.options.ignoreIfExists) {
      console.log(`Rename target ${change.newUri} already exists. Skipping rename.`);
      return;
    }
    try {
      await Deno.remove(newPath, { recursive: true });
    } catch (e) {
      console.error(e);
      return;
    }
  }

  const bufinfo = await fn.getbufinfo(denops);
  const oldBufinfo = bufinfo.filter((info) => info.name.startsWith(oldPath));

  // Save current edits before rename
  await vim.writeBuffers(denops, oldBufinfo.map((info) => info.bufnr));

  try {
    await Deno.rename(oldPath, newPath);
  } catch (e) {
    console.error(e);
    return;
  }

  await Promise.all(oldBufinfo.map(async (info) => {
    const newFilePath = info.name.replace(oldPath, newPath);
    const bufNr = await fn.bufadd(denops, newFilePath);
    await Promise.all(info.windows.map((winId) => vim.winSetBuf(denops, winId, bufNr)));
    await vim.bufDelete(denops, info.bufnr);
  }));
}

async function deleteFile(
  denops: Denops,
  change: DeleteFile,
) {
  const path = uriToPath(change.uri);
  if (!existsSync(path)) {
    if (!change.options?.ignoreIfNotExists) {
      console.error(`Cannot delete not existing file or directory ${path}`);
    }
    return;
  }

  try {
    await Deno.remove(path, { recursive: change.options?.recursive });
  } catch (e) {
    console.error(e);
    return;
  }

  const bufNr = await fn.bufadd(denops, path);
  await vim.bufDelete(denops, bufNr);
}

async function applyTextDocumentEdit(
  denops: Denops,
  change: TextDocumentEdit,
  offsetEncoding?: OffsetEncoding,
) {
  // Limitation: document version is not supported.
  const path = uriToPath(change.textDocument.uri);
  const bufNr = await fn.bufadd(denops, path);
  await applyTextEdit(denops, change.edits, bufNr, offsetEncoding);
}

async function applyTextEdit(
  denops: Denops,
  textEdits: TextEdit[],
  bufNr: number,
  offsetEncoding?: OffsetEncoding,
) {
  if (textEdits.length === 0) {
    return;
  }

  await fn.bufload(denops, bufNr);
  await op.buflisted.setBuffer(denops, bufNr, true);

  // Fix reversed range
  textEdits.forEach((textEdit) => {
    const { start, end } = textEdit.range;
    if (!isPositionBefore(start, end)) {
      textEdit.range = { start: end, end: start };
    }
  });

  // Execute in reverse order.
  // If executed from the start, the positions would be shifted based on the results.
  textEdits.sort((a, b) => isPositionBefore(a.range.start, b.range.start) ? 1 : -1);

  // Some LSP servers are depending on the VSCode behavior.
  // The VSCode will re-locate the cursor position after applying TextEdit so we also do it.
  const cursor = bufNr === (await fn.bufnr(denops)) && (await vim.getCursor(denops, 0));

  // Save and restore local marks since they get deleted by vim.bufSetText()
  const marks = (await fn.getmarklist(denops, bufNr))
    .filter((info) => /^'[a-z]$/.test(info.mark));

  await wrapA(fromA(textEdits)).forEach(async (textEdit) => {
    // Normalize newline characters to \n
    textEdit.newText = textEdit.newText.replace(/\r\n?/g, "\n");
    const texts = textEdit.newText.split("\n");

    // Note that this is the number of lines, so it is 1-index.
    const lineCount = await vim.bufLineCount(denops, bufNr);
    if (textEdit.range.start.line + 1 > lineCount) {
      // Append lines to the end of buffer `bufNr`.
      await fn.appendbufline(denops, bufNr, "$", texts);
    } else {
      const vimRange = {
        start: await decodeUtfPosition(denops, bufNr, textEdit.range.start, offsetEncoding),
        end: await decodeUtfPosition(denops, bufNr, textEdit.range.end, offsetEncoding),
      };
      const lastLine = await vim.getBufLine(
        denops,
        bufNr,
        Math.min(vimRange.end.line, lineCount - 1),
      );
      const lastLineLen = byteLength(lastLine);
      if (vimRange.end.line + 1 > lineCount) {
        // Some LSP servers may return +1 range of the buffer content
        vimRange.end = {
          line: lineCount - 1,
          character: lastLineLen,
        };
      } else if (vimRange.end.character + 1 > lastLineLen && textEdit.newText.endsWith("\n")) {
        // Properly handling replacements that go beyond the end of a line,
        // and ensuring no extra empty lines are added.
        texts.pop();
      }
      vimRange.end.character = Math.min(vimRange.end.character, lastLineLen);

      await vim.bufSetText(denops, bufNr, vimRange, texts);

      // Fix cursor position
      if (cursor && isPositionBefore(vimRange.end, cursor)) {
        cursor.line += texts.length - (vimRange.end.line - vimRange.start.line + 1);
        if (cursor.line === vimRange.end.line) {
          cursor.character += texts[texts.length - 1].length - vimRange.end.character;
          if (texts.length === 1) {
            cursor.character += vimRange.start.character;
          }
        }
      }
    }
  });
  const lineCount = await vim.bufLineCount(denops, bufNr);

  // No need to restore marks that still exist
  const remainMarkSet = new Set((await fn.getmarklist(denops, bufNr)).map((info) => info.mark));
  await wrapA(fromA(marks))
    .filter((info) => !remainMarkSet.has(info.mark))
    .map(async (info) => {
      info.pos[1] = Math.min(info.pos[1], lineCount);
      info.pos[2] = Math.min(
        info.pos[2],
        byteLength(await vim.getBufLine(denops, bufNr, info.pos[1] - 1)),
      );
      return info;
    })
    .toArray()
    .then(async (marks) => await vim.setMarks(denops, marks));

  // Apply fixed cursor position
  if (
    cursor &&
    cursor.line + 1 <= lineCount &&
    cursor.character + 1 < byteLength(await vim.getBufLine(denops, bufNr, cursor.line))
  ) {
    await vim.setCursor(denops, 0, cursor);
  }

  // Remove final line if needed
  if (
    (await op.endofline.getBuffer(denops, bufNr)) ||
    (await op.fixendofline.getBuffer(denops, bufNr) && !(await op.binary.getBuffer(denops, bufNr)))
  ) {
    const lastLine = await vim.getBufLine(denops, bufNr, -1);
    if (lastLine === "") {
      await fn.deletebufline(denops, bufNr, "$");
    }
  }
}

async function createPatchFromTextDocumentEdit(
  denops: Denops,
  change: TextDocumentEdit,
  offsetEncoding?: OffsetEncoding,
) {
  // Limitation: document version is not supported.
  const path = uriToPath(change.textDocument.uri);
  const bufNr = await fn.bufadd(denops, path);
  return await createPatchFromTextEdit(denops, change.edits, bufNr, offsetEncoding);
}

async function createPatchFromTextEdit(
  denops: Denops,
  textEdits: TextEdit[],
  bufNr: number,
  offsetEncoding?: OffsetEncoding,
) {
  await fn.bufload(denops, bufNr);

  const path = relative(Deno.cwd(), await bufNrToPath(denops, bufNr));
  const oldTexts = await fn.getbufline(denops, bufNr, 1, "$");
  const newTexts = await applyTextEditToLines(
    denops,
    textEdits,
    bufNr,
    [...oldTexts],
    offsetEncoding,
  );

  const patch = jsdiff.createPatch(
    path,
    oldTexts.join("\n"),
    newTexts.join("\n"),
  ).split("\n");

  // Overwrite header
  patch.shift();
  patch.shift();
  patch.unshift(`diff --code-action a/${path} b/${path}`);

  return patch;
}

async function applyTextEditToLines(
  denops: Denops,
  textEdits: TextEdit[],
  bufNr: number,
  lines: string[],
  offsetEncoding?: OffsetEncoding,
) {
  // Fix reversed range
  textEdits.forEach((textEdit) => {
    const { start, end } = textEdit.range;
    if (!isPositionBefore(start, end)) {
      textEdit.range = { start: end, end: start };
    }
  });

  // Execute in reverse order.
  // If executed from the start, the positions would be shifted based on the results.
  textEdits.sort((a, b) => isPositionBefore(a.range.start, b.range.start) ? 1 : -1);

  await wrapA(fromA(textEdits)).forEach(async (textEdit) => {
    // Normalize newline characters to \n
    textEdit.newText = textEdit.newText.replace(/\r\n?/g, "\n");
    const texts = textEdit.newText.split("\n");
    const range = {
      start: await toUtf16Position(denops, bufNr, textEdit.range.start, offsetEncoding),
      end: await toUtf16Position(denops, bufNr, textEdit.range.end, offsetEncoding),
    };

    const before = lines[range.start.line].slice(0, range.start.character);
    const after = lines[range.end.line].slice(range.end.character);
    texts[0] = before + texts[0];
    texts[texts.length - 1] += after;

    lines.splice(range.start.line, range.end.line - range.start.line + 1, ...texts);
  });

  return lines;
}
