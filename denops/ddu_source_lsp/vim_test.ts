import { test } from "https://deno.land/x/denops_test@v1.4.0/mod.ts";
import { Denops } from "https://deno.land/x/denops_std@v5.0.0/mod.ts";
import { MarkInformation } from "https://deno.land/x/denops_std@v5.0.0/function/types.ts";
import * as fn from "https://deno.land/x/denops_std@v5.0.0/function/mod.ts";
import { assertEquals } from "https://deno.land/std@0.191.0/testing/asserts.ts";

import * as vim from "./vim.ts";

async function openWithText(
  denops: Denops,
  bufname: string,
  text: string | string[],
): Promise<number> {
  const bufNr = await fn.bufadd(denops, bufname);
  await fn.bufload(denops, bufNr);
  await fn.setbufline(denops, bufNr, 1, text);
  return bufNr;
}

test({
  mode: "all",
  name: "getBufLine",
  fn: async (denops) => {
    const bufNr = await openWithText(denops, "getBufLine/test", ["foo", "bar", "baz"]);
    assertEquals(await vim.getBufLine(denops, bufNr, 0), "foo");
    assertEquals(await vim.getBufLine(denops, bufNr, 1), "bar");
    assertEquals(await vim.getBufLine(denops, bufNr, 2), "baz");
  },
});

test({
  mode: "all",
  name: "getCursor",
  fn: async (denops) => {
    const bufNr = await openWithText(denops, "getCursor/test", ["foo", "bar"]);
    await denops.cmd(`buffer ${bufNr}`);
    await fn.cursor(denops, 2, 3);
    const winId = await fn.win_getid(denops);
    assertEquals(await vim.getCursor(denops, winId), { line: 1, character: 2 });
  },
});

test({
  mode: "all",
  name: "selectRange",
  fn: async (denops, t) => {
    const bufNr = await openWithText(denops, "selectRange/test", ["😸cat", "🐶dog"]);
    await denops.cmd(`buffer ${bufNr}`);
    const winId = await fn.win_getid(denops);

    const steps = [
      {
        name: "n",
        cmd: "",
        expect: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      },
      {
        name: "v",
        cmd: "normal! vj$",
        expect: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 7 },
        },
      },
      {
        name: "V",
        cmd: "normal! Vj",
        expect: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 0 },
        },
      },
    ];

    for (const { name, cmd, expect } of steps) {
      await t.step({
        name,
        fn: async () => {
          await denops.cmd(cmd);
          assertEquals(await vim.selectRange(denops, winId), expect);
          // Reset
          // \x1b means <Esc>
          await fn.feedkeys(denops, "\x1b", "nx");
          await fn.cursor(denops, [1, 1]);
        },
      });
    }
  },
});

test({
  mode: "all",
  name: "setCursor",
  fn: async (denops) => {
    const bufNr = await openWithText(denops, "setCursor/test", ["foo", "bar"]);
    await denops.cmd(`buffer ${bufNr}`);
    const winId = await fn.win_getid(denops);
    await vim.setCursor(denops, winId, { line: 1, character: 2 });
    assertEquals(await fn.getcurpos(denops, winId), [0, 2, 3, 0, 3]);
  },
});

test({
  mode: "all",
  name: "winSetBuf",
  fn: async (denops) => {
    const winId = await fn.win_getid(denops);
    const buf1Nr = await fn.bufadd(denops, "winSetBuf/test1");
    await fn.bufload(denops, buf1Nr);
    await denops.cmd(`buffer ${buf1Nr}`);
    assertEquals(await fn.bufnr(denops), buf1Nr);
    const buf2Nr = await fn.bufadd(denops, "winSetBuf/test2");
    await fn.bufload(denops, buf2Nr);
    await vim.winSetBuf(denops, winId, buf2Nr);
    assertEquals(await fn.bufnr(denops), buf2Nr);
  },
});

test({
  mode: "all",
  name: "writeBuffers",
  fn: async (denops) => {
    await denops.cmd("new");
    const path = await Deno.makeTempFile();
    const bufNr = await openWithText(denops, path, ["😸cat", "🐶dog"]);
    assertEquals(await Deno.readTextFile(path), "");
    assertEquals(await fn.getbufline(denops, bufNr, 1, "$"), ["😸cat", "🐶dog"]);
    await vim.writeBuffers(denops, [bufNr]);
    assertEquals(await Deno.readTextFile(path), "😸cat\n🐶dog\n");
  },
});

test({
  mode: "all",
  name: "bufDelete",
  fn: async (denops) => {
    const bufNr = await openWithText(denops, "bufDelete/test", ["foo", "bar"]);
    assertEquals(await fn.bufnr(denops, bufNr), bufNr);
    await vim.bufDelete(denops, bufNr);
    assertEquals(await fn.bufnr(denops, bufNr), -1);
  },
});

test({
  mode: "all",
  name: "bufLineCount",
  fn: async (denops) => {
    const bufNr = await openWithText(denops, "bufLineCount/test", ["foo", "bar"]);
    assertEquals(await vim.bufLineCount(denops, bufNr), 2);
    await fn.appendbufline(denops, bufNr, "$", "baz");
    assertEquals(await vim.bufLineCount(denops, bufNr), 3);
  },
});

test({
  mode: "all",
  name: "bufSetText",
  fn: async (denops, t) => {
    const bufNr = await openWithText(denops, "bufSetText/test", ["foo", "bar", "baz"]);

    const steps = [
      {
        name: "single line",
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 3 },
        },
        text: ["hoge"],
        expect: ["foo", "hoge", "baz"],
      },
      {
        name: "multi line",
        range: {
          start: { line: 0, character: 2 },
          end: { line: 1, character: 1 },
        },
        text: ["cat", "dog"],
        expect: ["focat", "dogoge", "baz"],
      },
      {
        name: "increase line count",
        range: {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
        },
        text: ["o", ""],
        expect: ["foo", "cat", "dogoge", "baz"],
      },
      {
        name: "reduce line count",
        range: {
          start: { line: 0, character: 3 },
          end: { line: 2, character: 3 },
        },
        text: ["", "h"],
        expect: ["foo", "hoge", "baz"],
      },
    ];

    for (const { name, range, text, expect } of steps) {
      await t.step({
        name,
        fn: async () => {
          await vim.bufSetText(denops, bufNr, range, text);
          assertEquals(await fn.getbufline(denops, bufNr, 1, "$"), expect);
        },
      });
    }
  },
});

test({
  mode: "all",
  name: "bufSetMarks",
  fn: async (denops) => {
    const bufNr = await openWithText(denops, "bufSetMarks/test", ["foo", "bar"]);
    const marks: Pick<MarkInformation, "mark" | "pos">[] = [
      { mark: "'a", pos: [bufNr, 1, 1, 0] },
      { mark: "'b", pos: [bufNr, 1, 3, 0] },
      { mark: "'c", pos: [bufNr, 2, 1, 0] },
      { mark: "'d", pos: [bufNr, 2, 3, 0] },
    ];
    await vim.bufSetMarks(denops, bufNr, marks);
    const actualMarks = (await fn.getmarklist(denops, bufNr))
      .filter((info) => /'[a-d]/.test(info.mark));
    assertEquals(actualMarks, marks);
  },
});
