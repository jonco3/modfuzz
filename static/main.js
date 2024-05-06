// todo:
//  - large (and therefore off-thread parsed) modules
//  - root node is html
//  - multiple parents

import { Graph, Node, Edge, DFS } from "./graph.mjs";

let state;
let config = {};

let testCount;
let startTime;

let graph;
let error;
let result;
let loadOrder;
let loadStarted;
let loadFinished;
let loadErrored;

let startButton = document.getElementById("start");
let stepButton = document.getElementById("step");
let repeatButton = document.getElementById("repeat");
let stopButton = document.getElementById("stop");

startButton.onclick = start;
function start() {
  if (state) {
    return;
  }

  state = "running";
  startButton.disabled = true;
  stepButton.disabled = true;
  stopButton.disabled = false;

  testCount = 0;
  startTime = performance.now();
  runNextTest();
}

stepButton.onclick = step;
function step() {
  if (state) {
    return;
  }

  state = "step";
  testCount = 0;
  runNextTest();
}

repeatButton.onclick = repeat;
function repeat() {
  if (state) {
    return;
  }

  state = "repeat";
  testCount = 0;
  clear();
  testGeneratedGraph();
}

stopButton.onclick = stop;
function stop() {
  if (state !== "running") {
    return;
  }

  state = undefined;
  startButton.disabled = false;
  stepButton.disabled = false;
  stopButton.disabled = true;

  print("Stopped");
  print(`Ran ${testCount} tests`);
}

initConfigRange("size", "sizeDisplay");
initConfigBool("verbose");
initConfigBool("importMaps");
initConfigBool("missing");
initConfigBool("errors");
initConfigBool("preloads");
initConfigBool("delayResponses");

function initConfigRange(name, displayName) {
  const element = document.getElementById(name);
  const display = document.getElementById(displayName);
  const readConfig = () => {
    let value = parseInt(element.value);
    display.value = value;
    config[name] = value;
  };
  element.addEventListener("change", readConfig);
  readConfig();
}

function initConfigBool(name) {
  const element = document.getElementById(name);
  const readConfig = () => config[name] = element.checked;
  element.addEventListener("change", readConfig);
  readConfig();
}

let initialGraphSpec = document.location.hash;
if (initialGraphSpec) {
  let error;
  try {
    graph = Graph.fromString(initialGraphSpec.substring(1));
    print("Loaded graph: " + initialGraphSpec)
  } catch (error) {
    print("Error decoding hash: " + error);
  }

  if (graph) {
    repeatButton.disabled = false;
    repeat();
  }
}

function runNextTest() {
  if (!state) {
    return;
  }

  repeatButton.disabled = false;
  clear();
  fuzz();
}

function fuzz() {
  let size = rand(config.size - 1) + 2;
  let options = {
    pImportMap: config.importMaps ? 0.5 : 0.0,
    pNotFound: config.missing ? 0.25 : 0.0,
    pError: config.errors ? 0.25 : 0.0,
    pPreload: config.preloads ? 0.5 : 0.0,
    pDelayResponse: config.delayResponses ? 0.25 : 0.0
  };
  graph = buildScriptGraph(size, options);

  if (testCount > 10) {
    let elapsed = (performance.now() - startTime) / 1000;
    print(`Tests per second: ${(testCount / elapsed).toFixed(2)}`);
  }

  testGeneratedGraph();
}

function testGeneratedGraph() {
  testCount++;

  let pageURL = graph.getRootURL();

  if (config.verbose) {
    print(`Test ${testCount}:`);
    dumpGraph(graph);
  }

  error = undefined;
  result = undefined;
  initTestState(graph);
  loadPageInIFrame(pageURL);
}

window.addEventListener("message", (event) => {
  let message = event.data;

  let words = message.split(' ');
  let reason = words[0];

  if (!state) {
    print("Ignoring extra message: " + words[0]);
    return;
  }

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
    result = checkLoadedGraph(graph);
    testFinished(result, error);
  } else if (reason === "error") {
    if (words[2] === "GeneratedError") {
      let index = parseInt(words[3]);
      if (Number.isNaN(index)) {
        throw("Bad index in generated error: " + message);
      }
      loadErrored[index] = true;
    } else {
      result = "ERROR";
      error = message.substring(6);
      testFinished(result, error);
    }
  } else {
    throw "Unexpected message: " + message;
  }
});

function testFinished(result, error) {
  print(`Test finshed: ${result} ${error || ''}`);

  if (state === "running") {
    if (result === "OK") {
      runNextTest();
    } else {
      stop();
    }
    return;
  }

  state = undefined;
}

function loadPageInIFrame(url) {
  let iframe = document.createElement("iframe");
  iframe.sandbox = "allow-scripts allow-same-origin";
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

function buildScriptGraph(size, maybeOptions) {
  let options = {
    pModule: 0.75,
    pMultiParent: 1.0,
    pImportMap: 0.0,
    pTopLevelAwait: 0.0,
    pDynamic: 0.0,
    pCyclic: 0.0,
    pNotFound: 0.0,
    pError: 0.0,
    pPreload: 0.0,
    pDelayResponse: 0.0
  };

  if (maybeOptions) {
    Object.assign(options, maybeOptions);
  }

  // Per graph settings.
  const pMultiParent = options.pMultiParent / size;
  const pImportMap = options.pImportMap;
  const pTopLevelAwait = options.pTopLevelAwait / size;
  const pDynamic = options.pDynamic / size;
  const pCyclic = options.pCyclic / size - 1;
  const pNotFound = options.pNotFound / size;
  const pError = options.pError / size;
  const pPreload = options.pPreload;

  // Per script setting.
  const pModule = options.pModule;
  const pDelayResponse = options.pDelayResponse;

  const pBareImportGivenImportMap = 0.5;
  const pStaticImportMap = 0.5

  let graph = new Graph();

  let hasImportMap = choose(pImportMap);
  if (hasImportMap) {
    if (choose(pStaticImportMap)) {
      graph.hasStaticImportMap = true;
    } else {
      graph.hasDynamicImportMap = true;
    }
  }

  let pBareImport = hasImportMap ? pBareImportGivenImportMap : 0.0;

  let root = new Node(0, {});
  graph.addNode(root);

  // List of nodes that can import other nodes, so the root plus all module
  // scripts.
  let importers = [root];

  for (let i = 1; i < size; i++) {
    let flags = {
      isModule: choose(pModule),
      isNotFound: choose(pNotFound),
      isError: choose(pError),
      hasPreload: choose(pPreload),
      hasTopLevelAwait: choose(pTopLevelAwait),
      isSlow: choose(pDelayResponse)
    };

    let node = new Node(i, flags);
    graph.addNode(node);

    if (!node.isModule) {
      // Classic scripts can only by loaded by the page.
      graph.root.addImport(node);
      continue;
    }

    if (importers.length !== 0) {
      addImport(importers, node, pDynamic, pBareImport);
      while (choose(pMultiParent)) {
        addImport(importers, node, pDynamic, pBareImport);
      }
    }

    if (!node.isNotFound) {
      importers.push(node);
    }

    if (choose(pCyclic)) {
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
      node.addImport(ancestor, 0.0, pBareImport);

      // Introducing a cycle though a dynamic import can livelock, so turn off
      // async evaluation on path to ancestor.
      do {
        node.hasTopLevelAwait = false;
        edge = node.inEdges[0];
        edge.isDynamic = false;
        node = edge.source;
      } while (node !== ancestor)
    }
  }

  return graph;
}

function addImport(importers, node, pDynamic, pBareImport) {
  let parent = importers[rand(importers.length)];
  let isDynamic = choose(pDynamic);
  let isBare = !parent.isRoot && choose(pBareImport);
  parent.addImport(node, {isDynamic, isBare});
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
  print(`Graph of ${graph.size} nodes${dumpFlags(graph, Graph.flagNames)}`);
  let location = document.location.toString().split("#")[0];
  let rootURL = location + graph.getRootURL().substring(1);
  let baseURL = location + graph.getBaseURL().substring(1);

  let files = [];
  graph.forEachNode(node => {
    if (!node.isNotFound) {
      files.push(node.filename);
    }
  });
  let downloadCommand = `curl --remote-name-all ${baseURL}{${files.join()}}`;

  print(`  Test URL: ${location}#${graph.toString()}`);
  print(`  View source: view-source:${rootURL}`);
  print(`  Download with: ${downloadCommand}`);
  graph.forEachNode(node => {
    print(`  Node ${node.index}${dumpFlags(node, Node.flagNames)}`);
    node.outEdges.forEach(edge => {
      print(`   -> node ${edge.target.index}${dumpFlags(edge, Edge.flagNames)}`);
    });
  });
}

function dumpFlags(obj, names) {
  let flags = "";
  for (name of names) {
    if (obj[name]) {
      flags += " " + name;
    }
  }
  return flags;
}

function initTestState(graph) {
  loadOrder = [];
  loadFinished = new Array(graph.size).fill(false);
  loadStarted = new Array(graph.size).fill(false);
  loadErrored = new Array(graph.size).fill(false);
}

class AssertionError extends Error {
  constructor(message) {
    super(message);
  }
}

function checkLoadedGraph(graph) {
  if (config.verbose) {
    dumpLoadState();
  }

  try {
    if (graph.hasAsyncEvaluation() || graph.hasCycle()) {
      // Difficult to work out expectations without implementing the algorithm
      // itself. Run some simpler checks.
      simpleGraphCheck(graph);
    } else {
      fullGraphCheck(graph);
    }
    return "OK";
  } catch (error) {
    print(error);
    if (error instanceof AssertionError) {
      print("Graph check failed");
      if (!config.verbose) {
        dumpGraph(graph);
        dumpLoadState();
      }
      return "FAIL";
    }

    throw error;
  }
}

function dumpLoadState() {
  print("Load order: " + loadOrder.join(", "));
  print("Load started: " + loadStarted.join(", "));
  print("Load finished: " + loadFinished.join(", "));
  print("Load errored: " + loadErrored.join(", "));
}

function simpleGraphCheck(graph) {
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

function fullGraphCheck(graph) {
  let expectedOrder = [];
  let expectedStart = new Array(graph.size).fill(false);
  let expectedFinish = new Array(graph.size).fill(false);
  let expectedError = new Array(graph.size).fill(false);

  expectedOrder.push(graph.root.index);
  expectedStart[graph.root.index] = true;
  expectedFinish[graph.root.index] = true;

  // First, all classic scripts load.
  graph.root.forEachOutgoingEdge(node => {
    if (!node.isModule && !node.isNotFound) {
      expectedOrder.push(node.index);
      expectedStart[node.index] = true;
      expectedFinish[node.index] = !node.isError;
      expectedError[node.index] = node.isError;
    }
  });

  let moduleMap = new Set();

  // Then all modules, which are 'defer' by default.
  graph.root.forEachOutgoingEdge(node => {
    if (node.isModule && !node.isNotFound) {
      let found = true;
      DFS(node,
          node => {
            if (node.isNotFound) {
              found = false;
            }
          });
      if (!found) {
        return;
      }

      let failed = false;
      DFS(node,
          node => {
            if (failed) {
              return;
            }

            let index = node.index;
            if (!moduleMap.has(index)) {
              moduleMap.add(index);
              expectedOrder.push(index);
              expectedStart[index] = true;
              expectedFinish[index] = !node.isError;
              expectedError[index] = node.isError;
            }

            if (node.isError) {
              failed = true;
            }
          });
    }
  });

  assertEq(loadOrder.join(), expectedOrder.join());
  assertEq(loadStarted.join(), expectedStart.join());
  assertEq(loadFinished.join(), expectedFinish.join());
  assertEq(loadErrored.join(), expectedError.join());
}

function assertEq(actual, expected) {
  if (actual !== expected) {
    let message = `Assertion failure: expected ${expected} but got ${actual}`;
    throw new AssertionError(message);
  }
}
