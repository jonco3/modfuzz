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
}

export class Node {
  static flagNames = ['isError', 'isAsync'];
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
    let parts = [flags, this.outEdges.length];
    this.forEachOutgoingEdge((node, isAsync, isBare) => {
      parts.push(`${isAsync ? "a" : ""}${isBare ? "b" : ""}${node.index}`);
    });
    return parts.join(",");
  }

  initFromString(graph, str) {
    if (str === 0) {
      throw "Empty string";
    }

    let parts = str.split(",");
    if (parts.length < 2) {
      throw "Bad node size";
    }

    let {flags} = decodeFlags(parts.shift(), Node.flagDecodeMap);
    initFlags(this, flags, Node.flagNames);

    let size = parseInt(parts.shift());
    if (Number.isNaN(size) || parts.length !== size) {
      throw "Bad node size";
    }

    for (let part of parts) {
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
  constructor() {
    this.nodes = [];
    this.importMapKind = "none";
  }

  get size() {
    return this.nodes.length;
  }

  setImportMapKind(kind) {
    if (kind !== "none" && kind !== "static" && kind !== "dynamic") {
      throw "Bad import map kind";
    }
    this.importMapKind = kind;
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
    let flags = ""
    if (this.importMapKind !== "none") {
      flags = this.importMapKind[0];
    }
    let parts = [flags, this.size];
    this.forEachNode((node) => {
      parts.push(node.toString());
    });
    return parts.join(";");
  }

  static fromString(str) {
    if (str === 0) {
      throw "Empty string";
    }

    let parts = str.split(";");
    let flags = parts.shift();
    let importMapKind = "none";
    if (flags === "s") {
      importMapKind = "static";
    } else if (flags === "d") {
      importMapKind = "dynamic";
    } else if (flags !== "") {
      throw "Bad graph flags";
    }

    let size = parseInt(parts.shift());
    if (Number.isNaN(size) || parts.length !== size) {
      throw "Bad graph size";
    }

    let graph = new Graph();
    graph.setImportMapKind(importMapKind);
    for (let i = 0; i < size; i++) {
      graph.addNode(new Node(i));
    }
    for (let i = 0; i < size; i++) {
      graph.getNode(i).initFromString(graph, parts[i]);
    }

    return graph;
  }
}

function makeFlagEncodeMap(names) {
  // Map from names like 'isFoo' to initial letter of actual name 'f'.
  let map = {};
  for (let name of names) {
    if (name.length <= 2 || !name.startsWith('is')) {
      throw new Error("Bad flag name: " + name);
    }
    let char = name.charAt(2).toLowerCase();
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
