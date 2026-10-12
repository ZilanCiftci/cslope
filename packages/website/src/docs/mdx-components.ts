import type { MDXComponents } from "mdx/types";
import { A, Callout, Figure, Kbd, Step, Steps, Table } from "./components";

/** The components available in every doc, and the overrides for links and tables. */
export const MDX_COMPONENTS: MDXComponents = { a: A, table: Table, Figure, Callout, Steps, Step, Kbd };
