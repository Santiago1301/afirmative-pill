import { GraphQLError, GraphQLScalarType, Kind, type ValueNode } from 'graphql';

const fail = (message: string) => new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });

function intScalar(name: string, description: string, check: (n: number) => boolean, rule: string) {
  const parse = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || !check(value)) throw fail(`${name} debe ser ${rule}. Recibido: ${JSON.stringify(value)}`);
    return value;
  };
  return new GraphQLScalarType({
    name,
    description,
    serialize: (v) => parse(Number(v)),
    parseValue: parse,
    parseLiteral: (ast: ValueNode) => {
      if (ast.kind !== Kind.INT) throw fail(`${name} debe ser un entero literal.`);
      return parse(Number(ast.value));
    },
  });
}

export const Money = intScalar('Money', 'Pesos colombianos (COP), entero ≥ 0', (n) => n >= 0, 'un entero no negativo');
export const PositiveInt = intScalar('PositiveInt', 'Entero > 0', (n) => n > 0, 'un entero mayor que 0');

export const DateTime = new GraphQLScalarType({
  name: 'DateTime',
  description: 'Instante ISO-8601',
  serialize: (v) => {
    const d = v instanceof Date ? v : new Date(String(v));
    if (Number.isNaN(d.getTime())) throw fail('DateTime inválido');
    return d.toISOString();
  },
  parseValue: (v) => {
    const d = new Date(String(v));
    if (typeof v !== 'string' || Number.isNaN(d.getTime())) throw fail('DateTime debe ser un string ISO-8601.');
    return d;
  },
  parseLiteral: (ast) => {
    if (ast.kind !== Kind.STRING || Number.isNaN(Date.parse(ast.value))) throw fail('DateTime debe ser un string ISO-8601.');
    return new Date(ast.value);
  },
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseDate(v: unknown): string {
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw fail(`Date debe tener formato YYYY-MM-DD. Recibido: ${JSON.stringify(v)}`);
  }
  return v;
}

export const DateScalar = new GraphQLScalarType({
  name: 'Date',
  description: 'Fecha ISO-8601 (YYYY-MM-DD)',
  serialize: (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : parseDate(v)),
  parseValue: parseDate,
  parseLiteral: (ast) => {
    if (ast.kind !== Kind.STRING) throw fail('Date debe ser un string.');
    return parseDate(ast.value);
  },
});
