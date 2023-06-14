import { BaseFilter, DduItem } from "https://deno.land/x/ddu_vim@v3.0.2/types.ts";
import { SymbolKind } from "npm:vscode-languageserver-types@3.17.4-next.0";
import { isLike } from "https://deno.land/x/unknownutil@v2.1.1/is.ts";

export class Filter extends BaseFilter<Record<never, never>> {
  filter(args: {
    items: DduItem[];
  }): Promise<DduItem[]> {
    return Promise.resolve(args.items.map((item) => {
      if (isLike({ data: { kind: 1 } }, item)) {
        const kind = item.data.kind as SymbolKind;
        const kindName = KindName[kind];
        const kindIcon = KindIcon[kindName];
        const kindHl = KindHl[kindName];
        const { word, display = word, highlights = [] } = item;
        if (!display.startsWith(kindIcon)) {
          item.display = `${kindIcon} ${display}`;
          highlights.forEach((hl) => hl.col += 4);
          item.highlights = [
            ...highlights,
            {
              name: "lsp-symbol",
              hl_group: kindHl,
              col: 1,
              width: 19, // 3 (icon) + 1 (space) + 15 ([kindName])
            },
          ];
        }
      }
      return item;
    }));
  }

  params() {
    return {};
  }
}

export const KindName = {
  1: "File",
  2: "Module",
  3: "Namespace",
  4: "Package",
  5: "Class",
  6: "Method",
  7: "Property",
  8: "Field",
  9: "Constructor",
  10: "Enum",
  11: "Interface",
  12: "Function",
  13: "Variable",
  14: "Constant",
  15: "String",
  16: "Number",
  17: "Boolean",
  18: "Array",
  19: "Object",
  20: "Key",
  21: "Null",
  22: "EnumMember",
  23: "Struct",
  24: "Event",
  25: "Operator",
  26: "TypeParameter",
} as const satisfies Record<SymbolKind, string>;

export type KindName = typeof KindName[keyof typeof KindName];

const KindIcon = {
  File: "",
  Module: "",
  Namespace: "",
  Package: "",
  Class: "",
  Method: "",
  Property: "",
  Field: "",
  Constructor: "",
  Enum: "",
  Interface: "",
  Function: "",
  Variable: "",
  Constant: "",
  String: "",
  Number: "",
  Boolean: "",
  Array: "",
  Object: "",
  Key: "",
  Null: "",
  EnumMember: "",
  Struct: "",
  Event: "",
  Operator: "",
  TypeParameter: "",
} as const satisfies Record<KindName, string>;

const KindHl = {
  File: "Structure",
  Module: "Structure",
  Namespace: "Structure",
  Package: "Structure",
  Class: "Structure",
  Method: "Function",
  Property: "Identifier",
  Field: "Identifier",
  Constructor: "Structure",
  Enum: "Type",
  Interface: "Type",
  Function: "Function",
  Variable: "Identifier",
  Constant: "Constant",
  String: "String",
  Number: "Number",
  Boolean: "Boolean",
  Array: "Structure",
  Object: "Structure",
  Key: "Identifier",
  Null: "Special",
  EnumMember: "Identifier",
  Struct: "Structure",
  Event: "Type",
  Operator: "Operator",
  TypeParameter: "Type",
} as const satisfies Record<KindName, string>;
