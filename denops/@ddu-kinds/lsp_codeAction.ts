import {
  ActionFlags,
  Actions,
  applyTextEdits,
  BaseKind,
  Context,
  DduItem,
  Denops,
  dirname,
  existsSync,
  fn,
  fromA,
  fromFileUrl,
  getLines,
  jsdiff,
  LSP,
  PreviewContext,
  Previewer,
  setLines,
  uuid,
  wrapA,
} from "../ddu_source_lsp/deps.ts";
import { ItemContext } from "./lsp.ts";
import {
  bufNrToPath,
  pick,
  printError,
  toRelative,
  uriToBufNr,
  uriToPath,
} from "../ddu_source_lsp/util.ts";
import * as vim from "../ddu_source_lsp/vim.ts";
import { OffsetEncoding } from "../ddu_source_lsp/offset_encoding.ts";
import { lspRequest } from "../ddu_source_lsp/request.ts";

export type ActionData = {
  edit?: LSP.WorkspaceEdit;
  command?: LSP.Command;
  context: Omit<ItemContext, "method">;
  resolved?: boolean;
  codeAction?: LSP.CodeAction;
};

async function ensureAction(
  denops: Denops,
  item: DduItem,
): Promise<ActionData> {
  const action = item.action as ActionData;
  if (!action) {
    throw new Error(`Invalid usage of kind-lsp_codeAction`);
  }

  if (!action.resolved && action.edit === undefined && action.codeAction) {
    try {
      const resolvedCodeAction = await lspRequest(
        denops,
        action.context.client,
        "codeAction/resolve",
        action.codeAction,
        action.context.bufNr,
      ) as LSP.CodeAction | null;
      action.edit = resolvedCodeAction?.edit;
    } finally {
      action.resolved = true;
    }
  }

  return action;
}

type Params = Record<PropertyKey, never>;

export class Kind extends BaseKind<Params> {
  override actions: Actions<Params> = {
    apply: async (args: {
      denops: Denops;
      context: Context;
      items: DduItem[];
    }) => {
      if (args.items.length !== 1) {
        printError(
          args.denops,
          `Apply should be called on a single item.`,
          "kind-lsp_codeAction",
        );
        return ActionFlags.Persist;
      }
      const action = await ensureAction(args.denops, args.items[0]);

      if (action.edit) {
        await applyWorkspaceEdit(
          args.denops,
          action.edit,
          action.context.client.offsetEncoding,
        );
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
              const path = await toRelative(denops, fromFileUrl(change.uri));
              return [
                `diff --code-action a/${path} b/${path}`,
                "new file",
                "--- /dev/null",
                `+++ b/${path}`,
              ];
            } else if (change.kind === "rename") {
              const oldPath = await toRelative(
                denops,
                fromFileUrl(change.oldUri),
              );
              const newPath = await toRelative(
                denops,
                fromFileUrl(change.newUri),
              );
              return [
                `diff --code-action a/${oldPath} b/${newPath}`,
                `rename from ${oldPath}`,
                `rename to ${newPath}`,
              ];
            } else if (change.kind === "delete") {
              const path = await toRelative(denops, fromFileUrl(change.uri));
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
            return await createPatchFromTextEdit(
              denops,
              textEdits,
              bufNr,
              offsetEncoding,
            );
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
        contents: [
          `Command: ${action.command.title} (${action.command.command})`,
        ],
      };
    }
  }

  override params(): Params {
    return {};
  }
}

async function applyWorkspaceEdit(
  denops: Denops,
  workspaceEdit: LSP.WorkspaceEdit,
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
      await applyTextEdits(denops, bufNr, textEdits, offsetEncoding);
    }
  }
}

async function createFile(
  denops: Denops,
  change: LSP.CreateFile,
) {
  const path = uriToPath(change.uri);
  if (
    !existsSync(path) ||
    (change.options?.overwrite || !change.options?.ignoreIfExists)
  ) {
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.create(path);
  }
  await fn.bufadd(denops, path);
}

async function renameFile(
  denops: Denops,
  change: LSP.RenameFile,
) {
  const oldPath = uriToPath(change.oldUri);
  const newPath = uriToPath(change.newUri);

  if (existsSync(newPath)) {
    if (!change.options?.overwrite || change.options.ignoreIfExists) {
      printError(
        denops,
        `Rename target ${change.newUri} already exists. Skipping rename.`,
        "kind-lsp_codeAction",
      );
      return;
    }
    try {
      await Deno.remove(newPath, { recursive: true });
    } catch (e) {
      printError(denops, e, "kind-lsp_codeAction");
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
    printError(denops, e, "kind-lsp_codeAction");
    return;
  }

  await Promise.all(oldBufinfo.map(async (info) => {
    const newFilePath = info.name.replace(oldPath, newPath);
    const bufNr = await fn.bufadd(denops, newFilePath);
    await Promise.all(
      info.windows.map((winId) => vim.winSetBuf(denops, winId, bufNr)),
    );
    await vim.bufDelete(denops, info.bufnr);
  }));
}

async function deleteFile(
  denops: Denops,
  change: LSP.DeleteFile,
) {
  const path = uriToPath(change.uri);
  if (!existsSync(path)) {
    if (!change.options?.ignoreIfNotExists) {
      printError(
        denops,
        `Cannot delete not existing file or directory ${path}`,
        "kind-lsp_codeAction",
      );
    }
    return;
  }

  try {
    await Deno.remove(path, { recursive: change.options?.recursive });
  } catch (e) {
    printError(denops, e, "kind-lsp_codeAction");
    return;
  }

  const bufNr = await fn.bufadd(denops, path);
  await vim.bufDelete(denops, bufNr);
}

async function applyTextDocumentEdit(
  denops: Denops,
  change: LSP.TextDocumentEdit,
  offsetEncoding?: OffsetEncoding,
) {
  // Limitation: document version is not supported.
  const path = uriToPath(change.textDocument.uri);
  const bufNr = await fn.bufadd(denops, path);
  await applyTextEdits(denops, bufNr, change.edits, offsetEncoding);
}

async function createPatchFromTextDocumentEdit(
  denops: Denops,
  change: LSP.TextDocumentEdit,
  offsetEncoding?: OffsetEncoding,
) {
  // Limitation: document version is not supported.
  const path = uriToPath(change.textDocument.uri);
  const bufNr = await fn.bufadd(denops, path);
  return await createPatchFromTextEdit(
    denops,
    change.edits,
    bufNr,
    offsetEncoding,
  );
}

async function createPatchFromTextEdit(
  denops: Denops,
  textEdits: LSP.TextEdit[],
  bufNr: number,
  offsetEncoding?: OffsetEncoding,
) {
  await fn.bufload(denops, bufNr);

  const path = await toRelative(denops, await bufNrToPath(denops, bufNr));
  const oldTexts = await fn.getbufline(denops, bufNr, 1, "$");
  const newTexts = await getLinesAppliedTextEdit(
    denops,
    bufNr,
    textEdits,
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

async function getLinesAppliedTextEdit(
  denops: Denops,
  bufNr: number,
  textEdits: LSP.TextEdit[],
  offsetEncoding?: OffsetEncoding,
) {
  // Copy to tmp buffer
  const newBufnr = await fn.bufadd(denops, uuid.v1.generate() as string);
  await fn.bufload(denops, newBufnr);
  const lines = await getLines(denops, bufNr, 0, -1);
  await setLines(denops, newBufnr, 0, -1, lines);

  // Apply textEdits to tmp buffer
  await applyTextEdits(denops, newBufnr, textEdits, offsetEncoding);

  // Get lines
  const appliedLines = await getLines(denops, newBufnr, 0, -1);

  // Remove tmp buffer
  await denops.cmd(`bwipeout! ${newBufnr}`);

  return appliedLines;
}
