import type { MDXComponents } from "mdx/types";
import { A, Callout, Figure, Kbd, Pre, Step, Steps, Table } from "./components";

/** The components available in every doc, and the overrides for links and tables. */
export const MDX_COMPONENTS: MDXComponents = { a: A, table: Table, pre: Pre, Figure, Callout, Steps, Step, Kbd };
