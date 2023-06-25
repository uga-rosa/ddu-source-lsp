import { BaseFilter, DduItem, is, SymbolKind } from "../ddu_source_lsp/deps.ts";

type Params = {
  iconMap: Partial<Record<KindName, string>>;
  hlGroupMap: Partial<Record<KindName, string>>;
};

export class Filter extends BaseFilter<Params> {
  override filter(args: {
    items: DduItem[];
    filterParams: Params;
  }): Promise<DduItem[]> {
    const iconMap = {
      ...DefaultIconMap,
      ...args.filterParams.iconMap,
    };
    const hlGroupMap = {
      ...DefaultHlGroupMap,
      ...args.filterParams.hlGroupMap,
    };

    return Promise.resolve(args.items.map((item) => {
      if (is.ObjectOf({ data: is.ObjectOf({ kind: is.Number }) })(item)) {
        const kind = item.data.kind as SymbolKind;
        const kindName = KindName[kind];
        const kindIcon = iconMap[kindName];
        const kindHl = hlGroupMap[kindName];
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

  override params(): Params {
    return {
      iconMap: {},
      hlGroupMap: {},
    };
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

const DefaultIconMap = {
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

const DefaultHlGroupMap = {
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
