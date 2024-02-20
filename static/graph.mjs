export class Edge {
  constructor(source, target, isAsync, isBare) {
    this.source = source;
    this.target = target;
    this.isAsync = isAsync;
    this.isBare = isBare;
  }
}

export class Node {
  constructor(index, isRoot, isError, isAsync) {
    this.index = index;
    this.isRoot = isRoot;
    this.isError = isError;
    this.isAsync = isAsync;
    this.inEdges = [];
    this.outEdges = [];
    this.cachedSource = undefined;
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

  addImport(target, isAsync, isBare) {
    if (this.cachedSource) {
      throw "Can't add import after source generated";
    }

    let edge = new Edge(this, target, isAsync, isBare);
    this.outEdges.push(edge);
    target.inEdges.push(edge);

    if (isAsync) {
      this.isAsync = true;
    }
  }

  toString() {
    let flags = (this.isError ? "e" : "") +
        (this.isAsync ? "a" : "") +
        (this.isBare ? "b" : "");
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

    let flags = parts.shift();
    this.isAsync = flags.includes("a");
    this.isError = flags.includes("e");
    this.isBare = flags.includes("b");

    let size = parseInt(parts.shift());
    if (Number.isNaN(size) || parts.length !== size) {
      throw "Bad node size";
    }

    for (let part of parts) {
      let isAsync = false;
      if (part.startsWith("a")) {
        isAsync = true;
        part = part.substring(1);
      }
      let isBare = false;
      if (part.startsWith("b")) {
        isBare = true;
        part = part.substring(1);
      }
      let index = parseInt(part);
      if (Number.isNaN(index) || index >= graph.size) {
        throw "Bad node index";
      }
      this.addImport(graph.getNode(index), isAsync, isBare);
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
      let isRoot = i === 0;
      graph.addNode(new Node(i, isRoot, false, false));
    }
    for (let i = 0; i < size; i++) {
      graph.getNode(i).initFromString(graph, parts[i]);
    }

    return graph;
  }
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
