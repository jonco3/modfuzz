// todo:
//  - large (and therefore off-thread parsed) modules
//  - root node is html
//  - multiple parents

import { Graph, Node, DFS } from "./graph.mjs";

let state;
let testCount = 0;

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
  testCount++;
  graph = buildModuleGraph(2 + rand(8));

  dumpGraph(graph);

  let pageURL = getPageURL(graph.root.buildPageSource());

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
    checkModuleGraph(graph);
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

function getPageURL(htmlSource) {
  return `data:text/html,
    <!DOCTYPE html>
    <pre id="out"></pre>
    <script>
      window.addEventListener("error", (event) => {
        window.parent.postMessage("error " + event.message, "*");
      });
    </script>
  ` + htmlSource;
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

function buildModuleGraph(size, maybeOptions) {
  let options = {
    pMultiParent: 1.0,
    pAsync: 0.0,
    pDynamic: 0.0,
    pCyclic: 0.0,
    pError: 0.0
  };

  if (maybeOptions) {
    Object.assign(options, maybeOptions);
  }

  const pMultiParent = options.pMultiParent / size;
  const pAsync = options.pAsync / size;
  const pDynamic = options.pDynamic / size;
  const pCyclic = options.pCyclic / size - 1;
  const pError = options.pError / size;

  let graph = new Graph();
  for (let i = 0; i < size; i++) {
    let isRoot = i === 0;
    let isError = choose(pError);
    let isAsync = choose(pAsync);
    let node = new Node(i, isRoot, isError, isAsync);
    graph.addNode(node);
    if (!isRoot) {
      let parent = graph.getNode(rand(i));
      let isAsync = choose(pDynamic);
      parent.addImport(node, isAsync);

      while (choose(pMultiParent)) {
        parent = graph.getNode(rand(i));
        isAsync = choose(pDynamic);
        parent.addImport(node, isAsync);
      }
    }


    if (!isRoot && choose(pCyclic)) {
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

  return graph;
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
  print(`Test ${testCount}: Graph of ${graph.size} nodes`);
  graph.forEachNode(node => {
    print(`  Node ${node.index}${node.isAsync ? ' async' : ''}${node.isError ? ' error' : ''}`);
    node.forEachOutgoingEdge((out, isAsync) => {
      print(`   -> node ${out.index}${isAsync ? ' dynamic' : ''}`);
    });
  });
}

function initTestState(graph) {
  loadOrder = [];
  loadFinished = new Array(graph.size).fill(false);
  loadStarted = new Array(graph.size).fill(false);
}

function checkModuleGraph(graph, root) {
  print("Load log: " + loadOrder.join(", "));
  print("Loaded: " + loadFinished);

  if (graph.hasAsyncEvaluation() || graph.hasCycle()) {
    // Difficult to work out expectations without implementing the algorithm
    // itself. Run some simpler checks.
    print("Simple check");

    if (!graph.hasError()) {
      let expected = new Array(graph.size).fill(true);
      assertEq(loadStarted.join(), expected.join());
      assertEq(loadFinished.join(), expected.join());
    } else {
      graph.forEachNode(node => {
        if (node.isError) {
          assertEq(loadFinished[node.index], false);
        }
      });
    }

    return;
  }

  print("Full check");

  let expectedOrder = [];
  let expectedStart = new Array(graph.size).fill(false);
  let expectedEnd = new Array(graph.size).fill(false);

  let failed = false;
  DFS(graph.root,
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

function assertEq(actual, expected) {
  if (actual !== expected) {
    let message = `Assertion failure: expected ${expected} but got ${actual}`;
    print(message);
    throw new Error(message);
  }
}
