// Simple HTTP server based on:
// https://developer.mozilla.org/en-US/docs/Learn/Server-side/Node_server_without_framework

import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import {Readable} from 'stream';
import {Graph, DFS} from "./static/graph.mjs";

const PORT = 8000;

const STATIC_PATH = path.join(process.cwd(), "static");

const MIME_TYPE_DEFAULT = "application/octet-stream";
const MIME_TYPE_FOR_EXTENSION = {
  html: "text/html; charset=UTF-8",
  js: "text/javascript",
  mjs: "text/javascript",
};


class NotFoundError extends Error {
  constructor(message) {
    super(message);
  }
}

async function handleStaticFile(url)  {
  const paths = [STATIC_PATH, url];
  if (url.endsWith("/")) {
    paths.push("index.html");
  }

  const filePath = path.join(...paths);
  if (!filePath.startsWith(STATIC_PATH)) {
    throw new NotFoundError();
  }

  const toBool = [() => true, () => false];
  const exists = await fs.promises.access(filePath).then(...toBool);
  if (!exists) {
    throw new NotFoundError();
  }

  const ext = path.extname(filePath).substring(1).toLowerCase();
  const mimeType = MIME_TYPE_FOR_EXTENSION[ext] || MIME_TYPE_DEFAULT;
  const stream = fs.createReadStream(filePath);
  return { statusCode: 200, mimeType, stream };
};

let cachedEncodedGraph;
let cachedGraph;

async function handleGeneratedFile(url) {
  let parts = url.split("/").slice(2);

  let graph;
  let encodedGraph = parts[0];
  if (encodedGraph === cachedEncodedGraph) {
    graph = cachedGraph;
  } else {
    graph = Graph.fromString(decodeURI(encodedGraph));
    cachedEncodedGraph = encodedGraph;
    cachedGraph = graph;
  }

  let index = parseInt(parts[1]);
  if (Number.isNaN(index)) {
    throw new Error("Bad node index: " + parts[1]);
  }

  let node = graph.getNode(index);

  let mimeType;
  let data;
  if (node.isRoot) {
    mimeType = "text/html";
    data = buildPageSource(graph, node);
  } else {
    mimeType = "text/javascript";
    data = buildScriptSource(graph, node);
  }

  let stream = Readable.from(data, {encoding: 'utf8'});

  if (node.isSlow) {
    await sleep(1);
  }

  return { statusCode: 200, mimeType, stream };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildPageSource(graph, node) {
  if (!node.isRoot) {
    throw "Can't get page source for non-root script";
  }

  let lines = [
    '<!DOCTYPE html>',
    '<pre id="out"></pre>',
    '<script>',
    '  window.addEventListener("error", (event) => {',
    '    window.parent.postMessage("error " + event.error.toString(), "*");',
    '  });',
    '</script>'
  ];

  lines.push(`<script>window.parent.postMessage("start ${node.index}", "*");</script>`);

  if (node.isError) {
    lines.push(`<script>throw new Error("GeneratedError ${node.index}");</script>`);
  }

  if (node.isAsync) {
    throw "Not supported";
  }

  let sawModule = false;

  // Put preloads first if there is no import map.
  if (!graph.hasImportMap) {
    buildPreloads(graph, node, lines);
  }

  node.forEachOutgoingEdge((out, isDynamic, isBare) => {
    if (isDynamic) {
      throw "Not supported";
    }

    if (out.isModule && !sawModule) {
      sawModule = true;
      buildPreModuleContent(graph, node, lines);
    }

    let url;
    if (isBare) {
      url = out.index.toString();
    } else {
      url = graph.getNodeURL(out);
    }
    let options = '';
    if (out.isModule) {
      options = ' type="module"';
    }
    lines.push(`<script src="${url}"${options}></script>`);
  });

  lines.push(`<script type="module">`);
  // todo: async imports would come here
  lines.push(`  window.parent.postMessage("finish ${node.index}", "*");`);
  lines.push(`  window.parent.postMessage("loaded", "*");`);
  lines.push(`</script>`);

  return lines.join("\n");
}

function buildPreModuleContent(graph, node, lines) {
  // Add any import map before the first module script, allowing classic
  // scripts to precede it.
  if (graph.hasStaticImportMap) {
    lines.push(`<script type="importmap">${buildImportMap(graph)}</script>`);
  } else if (graph.hasDynamicImportMap) {
    lines.push(`<script>`,
               '  let script = document.createElement("script");',
               '  script.type = "importmap";',
               `  script.textContent = '${buildImportMap(graph)}';`,
               '  document.head.appendChild(script);',
               `</script>`);
  }

  // Add any preloads after the import map.
  if (graph.hasImportMap) {
    buildPreloads(graph, node, lines);
  }
}

function buildPreloads(graph, root, lines) {
  DFS(root, (node) => {
    if (node.hasPreload) {
      let kind = node.isModule ? 'modulepreload' : 'preload';
      let url = graph.getNodeURL(node);  // TODO: also try preloading remapped URLs?
      lines.push(`<link rel="${kind}" href="${url}" />`);
    }
  });
}

function buildImportMap(graph) {
  let imports = {};

  // Add bare names for all modules.
  for (let i = 1; i < graph.size; i++) {
    let name = i.toString();
    imports[name] = `./${name}`;
  }

  // TODO: Rearrange valid modules specifiers to test map is used.

  let map = { imports };
  return JSON.stringify(map);
}

function buildScriptSource(graph, node) {
  if (node.isRoot) {
    throw "Can't get script source for root page";
  }

  let lines = [
    `window.parent.postMessage("start ${node.index}", "*");`
  ];

  if (node.isError) {
    lines.push(`throw new Error("GeneratedError ${node.index}");`);
  }

  if (node.isAsync) {
    lines.push(`await 0;`);
  }

  if (node.isModule) {
    lines.push(`export default ${node.index};`);
  }

  let index = 0;
  node.forEachOutgoingEdge((out, isDynamic, isBare) => {
    let url;
    if (isBare) {
      url = out.index.toString();
    } else {
      url = graph.getNodeURL(out);
    }

    // Import the module and check the default export is what we expect.
    let name = "default_" + index;
    if (isDynamic) {
      lines.push(`let ${name} = await import("${url}").default;`);
    } else {
      lines.push(`import { default as ${name} } from "${url}";`);
    }
    lines.push(`if (${name} !== ${out.index}) {`);
    lines.push(`  throw "Unexpected export " + ${name} + " from module ${out.index}";`);
    lines.push(`}`);
    index++;
  });

  lines.push(`window.parent.postMessage("finish ${node.index}", "*");`);

  return lines.join("\n");
}

http.createServer(async (req, res) => {
  let statusCode;
  let mimeType = "text/plain";
  let stream;

  try {
    if (req.url.startsWith('/graph/')) {
      ({ statusCode, mimeType, stream } = await handleGeneratedFile(req.url));
    } else {
      ({ statusCode, mimeType, stream } = await handleStaticFile(req.url));
    }
  } catch (error) {
    if (error instanceof NotFoundError) {
      statusCode = 404;
      stream = Readable.from("File not found: " + req.url,
                             {encoding: 'utf8'});
    } else {
      console.log("Error: " + error);
      statusCode = 500;
      stream = Readable.from("Internal server error: " + error,
                             {encoding: 'utf8'});
    }
  }

  console.log(`${req.method} ${decodeURI(req.url)} => ${statusCode}`);
  res.writeHead(statusCode, {
    "Content-Type": mimeType
  });
  stream.pipe(res);
}).listen(PORT);

console.log(`Server running at http://127.0.0.1:${PORT}/`);
