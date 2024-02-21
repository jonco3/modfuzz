export class Edge {
  static flagNames = ['isAsync', 'isBare'];
  static flagEncodeMap = makeFlagEncodeMap(this.flagNames);
  static flagDecodeMap = invertMap(this.flagEncodeMap);

  constructor(source, target, flags) {
    this.source = source;
    this.target = target;
    this.isAsync = false;
    this.isBare = false;
    initFlags(this, flags, Edge.flagNames);
  }

  toString() {
    return encodeFlags(this, Edge.flagEncodeMap) + this.target.index.toString();
  }
}

export class Node {
  static flagNames = ['isModule', 'isError', 'isAsync'];
  static flagEncodeMap = makeFlagEncodeMap(this.flagNames);
  static flagDecodeMap = invertMap(this.flagEncodeMap);

  constructor(index, flags) {
    this.index = index;
    this.inEdges = [];
    this.outEdges = [];
    this.cachedSource = undefined;
    this.isRoot = index === 0;
    this.isError = false;
    this.isAsync = false;
    initFlags(this, flags, Node.flagNames);
  }

  get moduleName() {
    return "module" + this.index;
  }

  forEachOutgoingEdge(f) {
    for (let i = 0; i < this.outEdges.length; i++) {
      let edge = this.outEdges[i];
      f(edge.target, edge.isAsync, edge.isBare);
    }
  }

  forEachIncomingEdge(f) {
    for (let i = 0; i < this.inEdges.length; i++) {
      let edge = this.inEdges[i];
      f(edge.source, edge.isAsync, edge.isBare);
    }
  }

  addImport(target, edgeFlags) {
    if (this.cachedSource) {
      throw "Can't add import after source generated";
    }

    let edge = new Edge(this, target, edgeFlags);
    this.outEdges.push(edge);
    target.inEdges.push(edge);

    if (edge.isAsync) {
      this.isAsync = true;
    }
  }

  toString() {
    let flags = encodeFlags(this, Node.flagEncodeMap);
    let parts = ["n" + flags];
    this.outEdges.forEach(edge => {
      parts.push(edge.toString());
    });
    return `(${parts.join(" ")})`;
  }

  initFromExpr(graph, expr) {
    if (expr.length === 0) {
      throw "Empty node expression";
    }

    let first = expr.shift();
    if (typeof first !== "string" || !first.startsWith("n")) {
      throw new Error("Expected node flags string");
    }

    let {flags} = decodeFlags(first.substring(1), Node.flagDecodeMap);
    initFlags(this, flags, Node.flagNames);

    for (let part of expr) {
      if (typeof part !== "string") {
        throw new Error("Expected string");
      }
      let {flags, remain} = decodeFlags(part, Edge.flagDecodeMap);
      let index = parseInt(remain);
      if (Number.isNaN(index) || index >= graph.size) {
        throw "Bad node spec: " + part;
      }

      this.addImport(graph.getNode(index), flags);
    }
  }
}

export class Graph {
  static flagNames = ['hasStaticImportMap', 'hasDynamicImportMap'];
  static flagEncodeMap = makeFlagEncodeMap(this.flagNames);
  static flagDecodeMap = invertMap(this.flagEncodeMap);

  constructor(flags) {
    this.nodes = [];
    this.hasStaticImportMap = false;
    this.hasDynamicImportMap = false;
    initFlags(this, flags, Graph.flagNames);
    if (this.hasStaticImportMap && this.hasDynamicImportMap) {
      throw new Error("Can't have both kinds of importmap");
    }
  }

  get size() {
    return this.nodes.length;
  }

  addNode(node) {
    if (!node instanceof Node) {
      throw "Expected a Node";
    }
    this.nodes.push(node);
  }

  get root() {
    return this.getNode(0);
  }

  getNode(index) {
    if (index >= this.nodes.length) {
      throw "Node index out of range";
    }

    return this.nodes[index];
  }

  forEachNode(f) {
    this.nodes.forEach(f);
  }

  hasAsyncEvaluation() {
    for (let node of this.nodes) {
      if (node.isAsync) {
        return true;
      }
    }

    return false;
  }

  hasError() {
    for (let node of this.nodes) {
      if (node.isError) {
        return true;
      }
    }

    return false;
  }

  hasDynamicImport() {
    let result = false;
    for (let node of this.nodes) {
      node.forEachOutgoingEdge((target, isAsync) => {
        if (isAsync) {
          result = true;
        }
      });
    }

    return result;
  }

  hasCycle() {
    let result = false;
    for (let node of this.nodes) {
      node.forEachOutgoingEdge((target, isAsync) => {
        if (target.index < node.index) {
          result = true;
        }
      });
    }

    return result;
  }

  getRootURL() {
    return this.getNodeURL(this.root);
  }

  getNodeURL(node) {
    return `/graph/${this.toString()}/${node.index}`;
  }

  toString() {
    let flags = encodeFlags(this, Graph.flagEncodeMap);
    let parts = ["g" + flags];
    this.forEachNode((node) => {
      parts.push(node.toString());
    });
    return `(${parts.join(" ")})`;
  }

  static fromString(str) {
    let expr = parseListExpression(str);
    if (expr.length === 0) {
      throw new Error("Empty graph expression");
    }

    let first = expr.shift();
    if (typeof first !== "string" || !first.startsWith("g")) {
      throw new Error("Expected graph flags string");
    }
    let {flags} = decodeFlags(first.substring(1), Graph.flagDecodeMap);

    let graph = new Graph(flags);
    let size = expr.length;
    for (let i = 0; i < size; i++) {
      graph.addNode(new Node(i));
    }
    for (let i = 0; i < size; i++) {
      graph.getNode(i).initFromExpr(graph, expr[i]);
    }

    return graph;
  }
}

function makeFlagEncodeMap(names) {
  // Map from names like 'isFoo' or 'hasFoo' to initial letter of actual name 'f'.
  let map = {};
  for (let name of names) {
    let index = 0;
    if (name.startsWith('is')) {
      index = 2;
    } else if (name.startsWith('has')) {
      index = 3;
    }
    if (index === name.length) {
      throw new Error("Bad flag name: " + name);
    }
    let char = name.charAt(index).toLowerCase();
    if (map[char]) {
      throw new Error(`Duplicate flag char ${char} for flags: ${names}`);
    }
    map[name] = char;
  }
  return map;
}

function invertMap(map) {
  let result = {}
  for (let key in map) {
    let value = map[key];
    if (value in result) {
      throw new Error(`Duplicate key ${value} when inverting map`);
    }
    result[value] = key;
  }
  return result;
}

function initFlags(obj, flags, names) {
  for (let name in flags) {
    if (!names.includes(name)) {
      throw new Error(`Unknown flag name: ${name}`);
    }
    obj[name] = flags[name];
  }
}

function encodeFlags(obj, map) {
  let flags = "";
  for (let name in map) {
    if (obj[name]) {
      flags += map[name];
    }
  }
  return flags;
}

function decodeFlags(str, map) {
  let flags = {};
  while (str.length != 0) {
    let first = str.charAt(0);
    if (!first.match(/[a-z]/)) {
      break;
    }

    let flagName = map[first];
    if (!flagName) {
      throw new Error(`Unknown flag '${first}' for ${JSON.stringify(map)}`);
    }

    flags[flagName] = true;
    str = str.substring(1);
  }

  return { flags, remain: str };
}

function parseListExpression(input) {
  // A very basic s-expression parser.

  let index = 0;
  let root;
  let stack = [];
  let atom = "";

  while (index < input.length) {
    let c = input.charAt(index);
    index++;

    if (c === '(') {
      if (atom) {
        if (stack.length === 0) {
          throw new Error("Unexpected atom");
        }
        stack[stack.length - 1].push(atom);
      }
      atom = "";
      let e = [];
      if (stack.length === 0) {
        root = e;
      } else {
        stack[stack.length - 1].push(e);
      }
      stack.push(e);
    } else if (c === ')') {
      if (stack.length === 0) {
        throw new Error("Mismatched )");
      }
      if (atom) {
        stack[stack.length - 1].push(atom);
        atom = "";
      }
      stack.pop();
    } else if (c === ' ') {
      if (atom) {
        if (stack.length === 0) {
          throw new Error("Characters outside of list");
        }
        stack[stack.length - 1].push(atom);
        atom = "";
      }
    } else {
      atom += c;
    }
  }

  if (stack.length !== 0) {
    throw new Error("Missing )");
  }

  if (atom) {
    throw new Error("Unexpected atom");
  }

  if (!root) {
    throw new Error("No expression");
  }

  return root;
}

export function DFS(node, post, filter = () => true, visited = new Set()) {
  function traverse(node) {
    if (visited.has(node)) {
      return;
    }

    visited.add(node);

    node.forEachOutgoingEdge((out, isAsync) => {
      if (filter(out, isAsync)) {
        traverse(out);
      }
    });

    post(node);
  }

  traverse(node);
}
