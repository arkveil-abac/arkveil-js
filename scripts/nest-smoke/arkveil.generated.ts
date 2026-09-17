// Stand-in for `arkveil generate typescript` output: the shape the CLI emits,
// reduced to what the walkthrough needs.
export type ArkveilCodes = "invoices:edit" | "invoices:view";

export interface ArkveilUserAttributes {
  id?: string;
  role?: string;
  region?: string;
}

export interface ArkveilContextAttributes {
  region?: string;
}

declare module "arkveil" {
  interface ArkveilCodeRegistry {
    codes: ArkveilCodes;
  }
  interface ArkveilUserRegistry {
    attributes: ArkveilUserAttributes;
  }
  interface ArkveilContextRegistry {
    attributes: ArkveilContextAttributes;
  }
}
