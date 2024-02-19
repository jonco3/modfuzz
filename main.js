let state;

document.getElementById("start").onclick = start;
function start() {
  if (!state) {
    print("Starting");
    state = "running";
    runNextTest();
  }
}

document.getElementById("stop").onclick = stop;
function stop() {
  if (state === "running") {
    state = undefined;
    print("Stopping");
  }
}

function runNextTest() {
  if (!state) {
    return;
  }

  clear();
  fuzz();
}

let graph;
let finished;
let error;
let result;
let loadOrder;
let loadStarted;
let loadFinished;

function fuzz() {
  graph = buildModuleGraph(2 + rand(8));
  dumpGraph(graph);

  // todo: load from different root?
  // todo: this replaces loadModuleGraph
  let moduleURL = graph[0].getModuleURL();
  let pageURL = getPageURL(`
    import {} from "${moduleURL}";
    window.parent.postMessage("loaded", "*");
    document.getElementById('out').textContent = "loaded";
  `);

  finished = false;
  error = undefined;
  result = undefined;
  initTestState(graph);
  loadPageInIFrame(pageURL);
}

window.addEventListener("message", (event) => {
  let message = event.data;

  let words = message.split(' ');
  let reason = words[0];

  if (reason === "start") {
    let index = parseInt(words[1]);
    if (Number.isNaN(index)) {
      throw("Bad index in message: " + message);
    }
    loadStarted[index] = true;
    loadOrder.push(index);
  } else if (reason === "finish") {
    let index = parseInt(words[1]);
    if (Number.isNaN(index)) {
      throw("Bad index in message: " + message);
    }
    loadFinished[index] = true;
  } else if (reason === "loaded") {
    checkModuleGraph(graph, graph[0]);
    result = "OK";
    testFinished(result, error);
  } else if (reason === "error") {
    result = "ERROR";
    error = message.substring(6);
    testFinished(result, error);
  } else {
    throw "Unexpected message: " + message;
  }
});

function testFinished() {
  print(`Test finshed: ${result} ${error || ''}`);

  runNextTest()
}

function getModuleURL(id, source) {
  source = `/* ${id} */ ${source.trim()}`;  // Ensure unqiueness.
  return `data:text/javascript;base64,${btoa(source)}`;
}

function getPageURL(source) {
  source = source.trim()
  return `data:text/html,
    <!DOCTYPE html>
    <pre id="out"></pre>
    <script>
      window.addEventListener("error", (event) => {
        window.parent.postMessage("error " + event.message, "*");
      });
    </script>
    <script type="module">${source}</script>
  `;
}

function loadPageInIFrame(url) {
  let iframe = document.createElement("iframe");
  iframe.sandbox = "allow-scripts";
  iframe.src = url;
  
  let div = document.getElementById("content");
  div.replaceChildren(iframe);
}

function clear() {
    document.getElementById("out").textContent = "";
}

function print(s) {
    if (!s) {
        s = "";
    }
    document.getElementById("out").textContent += s + "\n";
}


class Edge {
  constructor(source, target, isAsync) {
    this.source = source;
    this.target = target;
    this.isAsync = isAsync;
  }
}

class Node {
  constructor(index, isError, isAsync) {
    this.index = index;
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
    return getModuleURL(this.index, this.getModuleSource());
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
    let lines = [
      `// Module ${this.moduleName}`,
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
}

function buildModuleGraph(size, maybeOptions) {
  let options = {
    pAsync: 0.0,
    pDynamic: 0.0,
    pCyclic: 0.0,
    pError: 0.0
  };

  if (maybeOptions) {
    Object.assign(options, maybeOptions);
  }
  
  const pAsync = options.pAsync / size;
  const pDynamic = options.pDynamic / size;
  const pCyclic = options.pCyclic / size - 1;
  const pError = options.pError / size;

  let nodes = new Array(size);
  for (let i = 0; i < size; i++) {
    let isError = choose(pError);
    let isAsync = choose(pAsync);
    let node = new Node(i, isError, isAsync);
    nodes[i] = node;
    if (i > 0) {
      let parent = nodes[rand(i)];
      let isAsync = choose(pDynamic);
      parent.addImport(node, isAsync);
    }

    if (i != 0 && choose(pCyclic)) {
      // Choose an ancestor to import.

      let ancestors = [];
      let edge = node.inEdges[0];
      while (true) {
        ancestors.push(edge.source);
        if (edge.source.index === 0) {
          break;
        }
        edge = edge.source.inEdges[0];
      }

      let ancestor = ancestors[rand(ancestors.length)];
      node.addImport(ancestor, false);

      // Introducing a cycle though a dynamic import can livelock, so turn off
      // async evaluation on path to ancestor.
      do {
        node.isAsync = false;
        edge = node.inEdges[0];
        edge.isAsync = false;
        node = edge.source;
      } while (node !== ancestor)
    }

  }

  return nodes;
}

// Random integer in range 0 to n exclusive.
// todo: replace with deterministic RNG and expose seed
function rand(n) {
  return Math.floor(Math.random() * n);
}

// Pick an alternative with probablity p.
function choose(p) {
  return Math.random() < p;
}

function dumpGraph(graph) {
  print(`Graph of ${graph.length} nodes`);
  for (let node of graph) {
    print(`  Node ${node.index}${node.isAsync ? ' async' : ''}${node.isError ? ' error' : ''}`);
    node.forEachOutgoingEdge((out, isAsync) => {
      print(`   -> node ${out.index}${isAsync ? ' dynamic' : ''}`);
    });
  }
}

function loadModuleGraph(graph) {
  clearModules();

  let modules = [];
  for (let node of graph) {
    let source = node.buildModuleSource();
    let module = registerModule(node.moduleName, parseModule(source));
    modules.push(module);
  }

  let rootIndex = rand(graph.length / 2);
  let root = modules[rootIndex];
  let rootNode = graph[rootIndex];

  initTestState(graph);
  if (choose(0.5)) {
    print(`Loading node ${rootIndex} statically`);
    moduleLink(root);
    moduleEvaluate(root);
  } else {
    print(`Loading node ${rootIndex} dynamically`);
    import(rootNode.moduleName);
  }
  drainJobQueue();
  checkModuleGraph(graph, rootNode);

  if (loadOrder.length < graph.length) {
    let index = rand(graph.length);
    let module = graph[index];
    print(`Loading node ${index} dynamically`);
    import(module.moduleName);
    drainJobQueue();
  }
}

function initTestState(graph) {
  loadOrder = [];
  loadFinished = new Array(graph.length).fill(false);
  loadStarted = new Array(graph.length).fill(false);
}

function checkModuleGraph(graph, root) {
  print("Load log: " + loadOrder.join(", "));
  print("Loaded: " + loadFinished);

  if (hasAsyncEvaluation(graph) || hasCycle(graph)) {
    // Difficult to work out expectations without implementing the algorithm
    // itself. Run some simpler checks.
    print("Simple check");

    if (!hasError(graph) && root === graph[0]) {
      let expected = new Array(graph.length).fill(true);
      assertEq(loadStarted.join(), expected.join());
      assertEq(loadFinished.join(), expected.join());
    } else {
      for (let node of graph) {
        if (node.isError) {
          assertEq(loadFinished[node.index], false);
        }
      }
    }

    return;
  }

  print("Full check");

  let expectedOrder = [];
  let expectedStart = new Array(graph.length).fill(false);
  let expectedEnd = new Array(graph.length).fill(false);

  let failed = false;
  DFS(root,
      node => {
        if (failed) {
          return;
        }

        expectedOrder.push(node.index);
        expectedStart[node.index] = true;
        expectedEnd[node.index] = !node.isError;

        if (node.isError) {
          failed = true;
        }
      });

  assertEq(loadOrder.join(), expectedOrder.join());
  assertEq(loadStarted.join(), expectedStart.join());
  assertEq(loadFinished.join(), expectedEnd.join());
}

function assertEq(a, b) {
  if (a !== b) {
    throw `Assertion failure: expected ${a} but got ${b}`;
  }
}

function hasAsyncEvaluation(graph) {
  for (let node of graph) {
    if (node.isAsync) {
      return true;
    }
  }

  return false;
}

function hasError(graph) {
  for (let node of graph) {
    if (node.isError) {
      return true;
    }
  }

  return false;
}

function hasDynamicImport(graph) {
  let result = false;
  for (let node of graph) {
    node.forEachOutgoingEdge((target, isAsync) => {
      if (isAsync) {
        result = true;
      }
    });
  }

  return result;
}

function hasCycle(graph) {
  let result = false;
  for (let node of graph) {
    node.forEachOutgoingEdge((target, isAsync) => {
      if (target.index < node.index) {
        result = true;
      }
    });
  }

  return result;
}

function DFS(node, post, filter = () => true, visited = new Set()) {
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
