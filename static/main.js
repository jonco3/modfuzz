// todo:
//  - large (and therefore off-thread parsed) modules
//  - root node is html
//  - multiple parents

import { Graph, Node, DFS } from "./graph.mjs";

let state;

let config;

let testCount;
let startTime;

document.getElementById("start").onclick = start;
function start() {
  if (!state) {
    print("Starting");
    state = "running";
    testCount = 0;
    startTime = performance.now();
    runNextTest();
  }
}

document.getElementById("step").onclick = step;
function step() {
  if (!state) {
    print("Starting");
    state = "step";
    testCount = 0;
    runNextTest();
  }
}

document.getElementById("stop").onclick = stop;
function stop() {
  if (state === "running") {
    state = undefined;
    print("Stopping");
    print(`Ran ${testCount} tests`);
  }
}

const showGraphElement = document.getElementById("showGraph");
showGraphElement.addEventListener("change", readConfig);
const importMapsElement = document.getElementById("importMaps");
importMapsElement.addEventListener("change", readConfig);

function readConfig() {
  config = {
    showGraph: showGraphElement.checked,
    importMaps: importMapsElement.checked
  };
}
readConfig();

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

  let options = {
    pImportMap: config.importMaps ? 0.5 : 0.0
  };
  graph = buildModuleGraph(2 + rand(8), options);

  if (testCount > 10) {
    let elapsed = (performance.now() - startTime) / 1000;
    print(`Tests per second: ${(testCount / elapsed).toFixed(2)}`);
  }

  let pageURL = graph.getRootURL();

  if (config.showGraph) {
    dumpGraph(graph);
  }

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

  if (state === "running") {
    runNextTest()
  } else {
    state = undefined;
  }
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
    pImportMap: 0.0,
    pAsync: 0.0,
    pDynamic: 0.0,
    pCyclic: 0.0,
    pError: 0.0
  };

  if (maybeOptions) {
    Object.assign(options, maybeOptions);
  }

  const pMultiParent = options.pMultiParent / size;
  const pImportMap = options.pImportMap;
  const pAsync = options.pAsync / size;
  const pDynamic = options.pDynamic / size;
  const pCyclic = options.pCyclic / size - 1;
  const pError = options.pError / size;

  const pBareImport = 0.5;
  const pStaticImportMap = 0.5

  let graph = new Graph();

  let hasImportMap = choose(pImportMap);
  if (hasImportMap) {
    graph.setImportMapKind(choose(pStaticImportMap) ? "static" : "dynamic");
  }

  for (let i = 0; i < size; i++) {
    let isRoot = i === 0;
    let isError = choose(pError);
    let isAsync = choose(pAsync);
    let node = new Node(i, isRoot, isError, isAsync);
    graph.addNode(node);
    if (!isRoot) {
      let parent = graph.getNode(rand(i));
      let isAsync = choose(pDynamic);
      let isBare = hasImportMap && choose(pBareImport);
      parent.addImport(node, isAsync, isBare);

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
  print(`  Source: view-source:${document.location}${graph.getRootURL().substring(1)}`);
  print(`  Import map: ${graph.importMapKind}`);
  graph.forEachNode(node => {
    print(`  Node ${node.index}${node.isAsync ? ' async' : ''}${node.isError ? ' error' : ''}`);
    node.forEachOutgoingEdge((out, isAsync, isBare) => {
      print(`   -> node ${out.index}${isAsync ? ' dynamic' : ''}${isBare ? ' bare' : ''}`);
    });
  });
}

function initTestState(graph) {
  loadOrder = [];
  loadFinished = new Array(graph.size).fill(false);
  loadStarted = new Array(graph.size).fill(false);
}

class AssertionError extends Error {
  constructor(message) {
    super(message);
  }
}

function checkModuleGraph(graph, root) {
  if (config.showGraph) {
    print("Load order: " + loadOrder.join(", "));
    print("Load started: " + loadStarted.join(", "));
    print("Load finished: " + loadFinished.join(", "));
  }

  try {
    if (graph.hasAsyncEvaluation() || graph.hasCycle()) {
      // Difficult to work out expectations without implementing the algorithm
      // itself. Run some simpler checks.
      simpleGraphCheck(graph, root);
    } else {
      fullGraphCheck(graph, root);
    }
  } catch (error) {
    print(error);
    if (error instanceof AssertionError) {
      print("Graph check failed:");
      if (!config.showGraph) {
        dumpGraph(graph);
        print("Load order: " + loadOrder.join(", "));
        print("Load started: " + loadStarted.join(", "));
        print("Load finished: " + loadFinished.join(", "));
      }
    }
    throw error;
  }
}

function simpleGraphCheck(graph, root) {
  // TODO: Can we improve these checks?

  if (!graph.hasError()) {
    let expected = new Array(graph.size).fill(true);
    assertEq(loadStarted.join(), expected.join());
    assertEq(loadFinished.join(), expected.join());
    return;
  }

  graph.forEachNode(node => {
    if (node.isError) {
      assertEq(loadFinished[node.index], false);
    }
  });
}

function fullGraphCheck(graph, root) {
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
    throw new AssertionError(message);
  }
}
