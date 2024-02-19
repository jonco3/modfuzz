export class Edge {
  constructor(source, target, isAsync) {
    this.source = source;
    this.target = target;
    this.isAsync = isAsync;
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

  getModuleURL() {
    // todo: not like this
    let source = `/* ${this.index} */ ${this.getModuleSource()}`;
    return `data:text/javascript;base64,${btoa(source)}`;
  }

  forEachOutgoingEdge(f) {
    for (let i = 0; i < this.outEdges.length; i++) {
      let edge = this.outEdges[i];
      f(edge.target, edge.isAsync);
    }
  }

  forEachIncomingEdge(f) {
    for (let i = 0; i < this.inEdges.length; i++) {
      let edge = this.inEdges[i];
      f(edge.source, edge.isAsync);
    }
  }

  addImport(target, isAsync) {
    if (this.cachedSource) {
      throw "Can't add import after source generated";
    }

    let edge = new Edge(this, target, isAsync);
    this.outEdges.push(edge);
    target.inEdges.push(edge);

    if (isAsync) {
      this.isAsync = true;
    }
  }

  getModuleSource() {
    if (!this.cachedSource) {
      this.cachedSource = this.buildModuleSource();
    }

    return this.cachedSource;
  }

  buildModuleSource() {
    if (this.isRoot) {
      throw "Can't get module source for root page";
    }

    let lines = [
      `window.parent.postMessage("start ${this.index}", "*");`
    ];

    if (this.isError) {
      lines.push(`throw new Error("${this.moduleName}");`);
    }

    if (this.isAsync) {
      lines.push(`await 0;`);
    }

    this.forEachOutgoingEdge((out, isAsync) => {
      if (isAsync) {
        lines.push(`await import("${out.getModuleURL()}");`);
      } else {
        lines.push(`import {} from "${out.getModuleURL()}";`);
      }
    });

    lines.push(`window.parent.postMessage("finish ${this.index}", "*");`);

    return lines.join("\n");
  }

  buildPageSource() {
    if (!this.isRoot) {
      throw "Can't get page source for non-root module";
    }

    let lines = [];

    if (this.isError) {
      lines.push(`<script>throw new Error("${this.moduleName}");</script>`);
    }

    if (this.isAsync) {
      throw "Not supported";
    }

    this.forEachOutgoingEdge((out, isAsync) => {
      if (isAsync) {
        throw "Not supported";
      }
      lines.push(`<script src="${out.getModuleURL()}" type="module"></script>`);
    });

    lines.push(`<script type="module">window.parent.postMessage("start ${this.index}", "*");</script>`);

    // todo: async imports would come here
    
    lines.push(`<script type="module">window.parent.postMessage("finish ${this.index}", "*");</script>`);
    lines.push(`<script type="module">window.parent.postMessage("loaded", "*");</script>`);

    return lines.join("\n");
  }
}

export class Graph {
  constructor() {
    this.nodes = [];
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
