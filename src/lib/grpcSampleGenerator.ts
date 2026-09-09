import { ProtoFieldSchema } from "./grpcClient";

const OMIT = Symbol("omit");
const MAX_DEPTH = 3;
const FIRST_NAMES = ["Avery", "Charlotte", "Ethan", "Grace", "Henry", "Isla", "Liam", "Maya", "Noah", "Sophie"];
const LAST_NAMES = ["Bennett", "Carter", "Collins", "Foster", "Hayes", "Morgan", "Parker", "Reed", "Walker", "Wright"];
const CITIES = ["Austin", "Boston", "Chicago", "Denver", "London", "New York", "Portland", "San Diego", "Seattle", "Toronto"];
const COUNTRIES = ["Australia", "Canada", "Ireland", "New Zealand", "Singapore", "United Kingdom", "United States"];
const STREETS = ["Cedar Avenue", "Hill Street", "Lake Road", "Maple Drive", "Oak Street", "Park Lane", "River Road"];
const COMPANIES = ["Acme Labs", "Bluebird Systems", "Evergreen Studio", "Northstar Works", "Orbit Software", "Summit Group"];
const WORDS = ["bright", "cloud", "forest", "gentle", "harbor", "meadow", "modern", "quiet", "river", "silver", "swift", "valley"];
const DOMAINS = ["example.com", "example.net", "mail.test", "sample.org"];

class SeededRandom {
  constructor(private state: number) {}

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(values: readonly T[]): T {
    return values[this.int(0, values.length - 1)];
  }
}

function hashSeed(seed: number, path: string): number {
  let hash = (seed >>> 0) ^ 0x811c9dc5;
  for (let index = 0; index < path.length; index++) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function randomFor(seed: number, path: string): SeededRandom {
  return new SeededRandom(hashSeed(seed, path));
}

function words(random: SeededRandom, count = random.int(1, 4)): string {
  return Array.from({ length: count }, () => random.pick(WORDS)).join(" ");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
}

function randomText(random: SeededRandom, length: number, alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"): string {
  return Array.from({ length }, () => alphabet[random.int(0, alphabet.length - 1)]).join("");
}

function uuid(random: SeededRandom): string {
  const hex = () => random.int(0, 15).toString(16);
  const group = (length: number) => Array.from({ length }, hex).join("");
  return `${group(8)}-${group(4)}-4${group(3)}-${random.pick(["8", "9", "a", "b"])}${group(3)}-${group(12)}`;
}

function semanticString(name: string, random: SeededRandom): string | undefined {
  const normalized = name.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const firstName = random.pick(FIRST_NAMES);
  const lastName = random.pick(LAST_NAMES);
  if (normalized.includes("email")) return `${slug(firstName)}.${slug(lastName)}@${random.pick(DOMAINS)}`;
  if (normalized.includes("firstname") || normalized === "givenname") return firstName;
  if (normalized.includes("lastname") || normalized === "surname") return lastName;
  if (normalized === "name" || normalized.includes("fullname")) return `${firstName} ${lastName}`;
  if (normalized === "username") return `${slug(firstName)}${random.int(10, 999)}`;
  if (normalized.includes("phone") || normalized.includes("mobile")) return `+1-555-${random.int(100, 999)}-${random.int(1000, 9999)}`;
  if (normalized.includes("address") || normalized.includes("street")) return `${random.int(10, 999)} ${random.pick(STREETS)}`;
  if (normalized.includes("city")) return random.pick(CITIES);
  if (normalized.includes("country")) return random.pick(COUNTRIES);
  if (normalized.includes("company") || normalized.includes("organization")) return random.pick(COMPANIES);
  if (normalized.includes("url") || normalized.includes("website") || normalized.includes("homepage")) return `https://${random.pick(DOMAINS)}/${random.pick(WORDS)}`;
  if (normalized === "id" || normalized.endsWith("id") || normalized.includes("uuid")) return uuid(random);
  if (normalized.includes("password")) return `${randomText(random, 8)}!${random.int(10, 99)}`;
  if (normalized.includes("token") || normalized.includes("secret")) return randomText(random, 24);
  if (normalized.includes("message") || normalized.includes("description") || normalized.includes("text")) {
    const sentence = words(random, random.int(5, 9));
    return `${sentence[0].toUpperCase()}${sentence.slice(1)}.`;
  }
  return undefined;
}

function wellKnownValue(field: ProtoFieldSchema, random: SeededRandom): unknown | typeof OMIT {
  switch (field.typeName) {
    case "google.protobuf.Timestamp": {
      const from = Date.UTC(2020, 0, 1);
      const to = Date.UTC(2030, 11, 31, 23, 59, 59);
      return new Date(from + Math.floor(random.next() * (to - from))).toISOString();
    }
    case "google.protobuf.Duration": return `${random.int(1, 300)}s`;
    case "google.protobuf.FieldMask": return "name,status";
    case "google.protobuf.DoubleValue":
    case "google.protobuf.FloatValue": return Math.round(random.next() * 100_000) / 100;
    case "google.protobuf.Int32Value":
    case "google.protobuf.UInt32Value": return random.int(1, 10_000);
    case "google.protobuf.Int64Value":
    case "google.protobuf.UInt64Value": return String(random.int(1, 1_000_000));
    case "google.protobuf.BoolValue": return random.next() >= 0.5;
    case "google.protobuf.StringValue": return semanticString(field.name, random) ?? words(random);
    case "google.protobuf.BytesValue": return randomText(random, 12);
    case "google.protobuf.Struct": return { sampleKey: words(random, 2) };
    case "google.protobuf.ListValue": return [random.pick(WORDS), random.int(1, 100)];
    case "google.protobuf.Value": return words(random, 2);
    case "google.protobuf.Empty": return {};
    case "google.protobuf.Any": return OMIT;
    default: return OMIT;
  }
}

function scalarValue(field: ProtoFieldSchema, random: SeededRandom): unknown | typeof OMIT {
  if (field.kind === "string") {
    if (field.typeName === "bytes") return randomText(random, 12);
    return semanticString(field.name, random) ?? words(random);
  }
  if (field.kind === "bool") return random.next() >= 0.5;
  if (field.kind === "enum") {
    const values = field.enumValues ?? [];
    const candidates = values.length > 1 ? values.slice(1) : values;
    return candidates.length ? random.pick(candidates) : OMIT;
  }
  if (field.kind === "number") {
    if (field.typeName === "double" || field.typeName === "float") return Math.round(random.next() * 100_000) / 100;
    const minimum = field.typeName.startsWith("u") || field.typeName.startsWith("fixed") ? 1 : -10_000;
    const value = random.int(minimum, 10_000);
    return field.typeName.includes("64") ? String(value) : value;
  }
  return OMIT;
}

function fieldValue(field: ProtoFieldSchema, seed: number, path: string, depth: number): unknown | typeof OMIT {
  const random = randomFor(seed, path);
  if (field.kind === "map") {
    if (!field.mapValue) return {};
    const value = fieldValue({ ...field.mapValue, name: field.name, repeated: false }, seed, `${path}.sampleKey`, depth);
    return value === OMIT ? {} : { sampleKey: value };
  }
  if (field.kind === "message") {
    const wellKnown = wellKnownValue(field, random);
    if (wellKnown !== OMIT) return wellKnown;
    if (depth >= MAX_DEPTH || !field.fields?.length) return {};
    return messageValue(field.fields, seed, path, depth + 1);
  }
  return scalarValue(field, random);
}

function messageValue(fields: ProtoFieldSchema[], seed: number, path: string, depth: number): Record<string, unknown> {
  const selectedOneofs = new Map<string, string>();
  for (const field of fields) {
    if (!field.oneof || selectedOneofs.has(field.oneof)) continue;
    const alternatives = fields.filter((candidate) => candidate.oneof === field.oneof);
    selectedOneofs.set(field.oneof, randomFor(seed, `${path}.oneof.${field.oneof}`).pick(alternatives).name);
  }

  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.oneof && selectedOneofs.get(field.oneof) !== field.name) continue;
    const fieldPath = `${path}.${field.name}`;
    if (field.repeated) {
      const length = randomFor(seed, `${fieldPath}.length`).int(1, 3);
      const values = Array.from({ length }, (_, index) => fieldValue(field, seed, `${fieldPath}[${index}]`, depth))
        .filter((value) => value !== OMIT);
      if (values.length) result[field.name] = values;
      continue;
    }
    const value = fieldValue(field, seed, fieldPath, depth);
    if (value !== OMIT) result[field.name] = value;
  }
  return result;
}

export function generateGrpcSample(fields: ProtoFieldSchema[], seed: number): string {
  return JSON.stringify(messageValue(fields, seed >>> 0, "request", 0), null, 2);
}
