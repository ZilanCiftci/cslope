import type { MaterialModel } from "@cslope/engine";

export interface ParameterDef {
  id?: string;
  name: string;
  expression: string;
}

export interface CoordinateExpression {
  x?: string;
  y?: string;
}

export type MaterialExpressions = Partial<Record<string, string>>;

export interface ResolvedParameters {
  resolved: Record<string, number>;
  errors: Record<string, string>;
}

export class ExpressionError extends Error {
  readonly code:
    | "EMPTY"
    | "TOKEN"
    | "SYNTAX"
    | "UNKNOWN_VARIABLE"
    | "DIVISION_BY_ZERO";

  constructor(
    code:
      | "EMPTY"
      | "TOKEN"
      | "SYNTAX"
      | "UNKNOWN_VARIABLE"
      | "DIVISION_BY_ZERO",
    message: string,
  ) {
    super(message);
    this.name = "ExpressionError";
    this.code = code;
  }
}

type TokenType =
  | "number"
  | "ident"
  | "plus"
  | "minus"
  | "mul"
  | "div"
  | "lparen"
  | "rparen"
  | "eof";

interface Token {
  type: TokenType;
  lexeme: string;
  value?: number;
}

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function evaluate(
  expression: string,
  vars: Record<string, number>,
): number {
  const source = expression.trim();
  if (source.length === 0) {
    throw new ExpressionError("EMPTY", "Expression is empty.");
  }

  const parser = new Parser(tokenize(source), vars);
  const value = parser.parseExpression();
  parser.expect("eof", "Unexpected token at end of expression.");
  return value;
}

export function resolveParameters(defs: ParameterDef[]): ResolvedParameters {
  const resolved: Record<string, number> = {};
  const errors: Record<string, string> = {};

  const grouped = new Map<string, ParameterDef[]>();
  for (const def of defs) {
    const name = def.name.trim();
    if (!IDENTIFIER_RE.test(name)) {
      if (name.length > 0) {
        errors[name] = "Parameter name is invalid.";
      }
      continue;
    }

    const list = grouped.get(name) ?? [];
    list.push({ ...def, name });
    grouped.set(name, list);
  }

  for (const [name, list] of grouped.entries()) {
    if (list.length > 1) {
      errors[name] = "Duplicate parameter name.";
    }
  }

  const nameToDef = new Map<string, ParameterDef>();
  for (const [name, list] of grouped.entries()) {
    if (list.length === 1 && !errors[name]) {
      nameToDef.set(name, list[0]);
    }
  }

  const deps = new Map<string, Set<string>>();
  for (const [name, def] of nameToDef.entries()) {
    const trimmed = def.expression.trim();
    if (trimmed.length === 0) {
      errors[name] = "Expression is empty.";
      continue;
    }

    try {
      deps.set(name, collectIdentifiers(trimmed));
    } catch (err) {
      errors[name] = toMessage(err);
    }
  }

  const visiting = new Set<string>();
  const done = new Set<string>();

  const visit = (name: string): void => {
    if (done.has(name) || errors[name]) return;
    if (visiting.has(name)) {
      errors[name] = "Circular reference detected.";
      return;
    }

    visiting.add(name);

    for (const dep of deps.get(name) ?? []) {
      if (!nameToDef.has(dep)) {
        errors[name] = `Unknown variable: ${dep}.`;
        continue;
      }
      visit(dep);
      if (errors[dep] && !errors[name]) {
        errors[name] = `Depends on invalid parameter: ${dep}.`;
      }
    }

    visiting.delete(name);

    if (!errors[name]) {
      const def = nameToDef.get(name);
      if (!def) {
        errors[name] = "Parameter definition is missing.";
      } else {
        try {
          resolved[name] = evaluate(def.expression, resolved);
        } catch (err) {
          errors[name] = toMessage(err);
        }
      }
    }

    done.add(name);
  };

  for (const name of nameToDef.keys()) {
    visit(name);
  }

  return { resolved, errors };
}

export function resolveCoordinates(
  coordinates: [number, number][],
  expressions: CoordinateExpression[],
  vars: Record<string, number>,
): [number, number][] {
  return coordinates.map(([x, y], index) => {
    const expr = expressions[index] ?? {};
    let nextX = x;
    let nextY = y;

    if (expr.x && expr.x.trim().length > 0) {
      try {
        nextX = evaluate(expr.x, vars);
      } catch {
        nextX = x;
      }
    }

    if (expr.y && expr.y.trim().length > 0) {
      try {
        nextY = evaluate(expr.y, vars);
      } catch {
        nextY = y;
      }
    }

    return [nextX, nextY];
  });
}

export function resolveMaterialModel(
  model: MaterialModel,
  expressions: MaterialExpressions | undefined,
  vars: Record<string, number>,
): MaterialModel {
  if (!expressions) return model;

  const next = { ...model } as MaterialModel & Record<string, unknown>;

  for (const [field, expression] of Object.entries(expressions)) {
    if (typeof expression !== "string") continue;
    const expr = expression.trim();
    if (expr.length === 0) continue;

    const current = next[field];
    if (typeof current !== "number" && typeof current !== "undefined") {
      continue;
    }

    try {
      next[field] = evaluate(expr, vars);
    } catch {
      // Keep last valid numeric value for this field.
      next[field] = current;
    }
  }

  return next;
}

function collectIdentifiers(expression: string): Set<string> {
  const ids = new Set<string>();
  for (const token of tokenize(expression)) {
    if (token.type === "ident") {
      ids.add(token.lexeme);
    }
  }
  return ids;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }

    if (isDigit(ch) || ch === ".") {
      const start = i;
      let seenDot = ch === ".";
      i += 1;

      while (i < source.length) {
        const c = source[i];
        if (isDigit(c)) {
          i += 1;
          continue;
        }
        if (c === "." && !seenDot) {
          seenDot = true;
          i += 1;
          continue;
        }
        break;
      }

      const lexeme = source.slice(start, i);
      if (lexeme === ".") {
        throw new ExpressionError("TOKEN", "Invalid number literal '.'.");
      }
      const value = Number.parseFloat(lexeme);
      if (!Number.isFinite(value)) {
        throw new ExpressionError(
          "TOKEN",
          `Invalid number literal '${lexeme}'.`,
        );
      }
      tokens.push({ type: "number", lexeme, value });
      continue;
    }

    if (isIdentifierStart(ch)) {
      const start = i;
      i += 1;
      while (i < source.length && isIdentifierPart(source[i])) {
        i += 1;
      }
      const lexeme = source.slice(start, i);
      tokens.push({ type: "ident", lexeme });
      continue;
    }

    switch (ch) {
      case "+":
        tokens.push({ type: "plus", lexeme: ch });
        i += 1;
        break;
      case "-":
        tokens.push({ type: "minus", lexeme: ch });
        i += 1;
        break;
      case "*":
        tokens.push({ type: "mul", lexeme: ch });
        i += 1;
        break;
      case "/":
        tokens.push({ type: "div", lexeme: ch });
        i += 1;
        break;
      case "(":
        tokens.push({ type: "lparen", lexeme: ch });
        i += 1;
        break;
      case ")":
        tokens.push({ type: "rparen", lexeme: ch });
        i += 1;
        break;
      default:
        throw new ExpressionError("TOKEN", `Unexpected character '${ch}'.`);
    }
  }

  tokens.push({ type: "eof", lexeme: "" });
  return tokens;
}

class Parser {
  private idx = 0;
  private readonly tokens: Token[];
  private readonly vars: Record<string, number>;

  constructor(tokens: Token[], vars: Record<string, number>) {
    this.tokens = tokens;
    this.vars = vars;
  }

  parseExpression(): number {
    let value = this.parseTerm();

    while (this.match("plus") || this.match("minus")) {
      const op = this.previous();
      const rhs = this.parseTerm();
      value = op.type === "plus" ? value + rhs : value - rhs;
    }

    return value;
  }

  expect(type: TokenType, message: string): Token {
    if (this.check(type)) {
      return this.advance();
    }
    throw new ExpressionError("SYNTAX", message);
  }

  private parseTerm(): number {
    let value = this.parseUnary();

    while (this.match("mul") || this.match("div")) {
      const op = this.previous();
      const rhs = this.parseUnary();
      if (op.type === "mul") {
        value *= rhs;
      } else {
        if (rhs === 0) {
          throw new ExpressionError("DIVISION_BY_ZERO", "Division by zero.");
        }
        value /= rhs;
      }
    }

    return value;
  }

  private parseUnary(): number {
    if (this.match("minus")) {
      return -this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    if (this.match("number")) {
      return this.previous().value ?? 0;
    }

    if (this.match("ident")) {
      const name = this.previous().lexeme;
      if (!(name in this.vars)) {
        throw new ExpressionError(
          "UNKNOWN_VARIABLE",
          `Unknown variable: ${name}.`,
        );
      }
      return this.vars[name];
    }

    if (this.match("lparen")) {
      const value = this.parseExpression();
      this.expect("rparen", "Expected ')' after expression.");
      return value;
    }

    throw new ExpressionError("SYNTAX", "Expected number, variable, or '(' .");
  }

  private match(type: TokenType): boolean {
    if (!this.check(type)) return false;
    this.advance();
    return true;
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.idx += 1;
    }
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === "eof";
  }

  private peek(): Token {
    return this.tokens[this.idx];
  }

  private previous(): Token {
    return this.tokens[this.idx - 1];
  }
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentifierStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentifierPart(ch: string): boolean {
  return isIdentifierStart(ch) || isDigit(ch);
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown expression error.";
}
