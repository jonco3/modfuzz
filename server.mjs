// Simple HTTP server based on:
// https://developer.mozilla.org/en-US/docs/Learn/Server-side/Node_server_without_framework

import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import {Readable} from 'stream';
import { Graph } from "./static/graph.mjs";

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

async function handleGeneatedFile(url) {
  let parts = url.split("/").slice(2);
  let graph = Graph.fromString(parts[0]);
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
    data = buildModuleSource(graph, node);
  }

  let stream = Readable.from(data, {encoding: 'utf8'});
  return { statusCode: 200, mimeType, stream };
}

function buildPageSource(graph, node) {
  if (!node.isRoot) {
    throw "Can't get page source for non-root module";
  }

  let lines = [
    '<!DOCTYPE html>',
    '<pre id="out"></pre>',
    '<script>',
    '  window.addEventListener("error", (event) => {',
    '    window.parent.postMessage("error " + event.message, "*");',
    '  });',
    '</script>'
  ];

  if (node.isError) {
    lines.push(`<script>throw new Error("${node.moduleName}");</script>`);
  }

  if (node.isAsync) {
    throw "Not supported";
  }

  node.forEachOutgoingEdge((out, isAsync) => {
    if (isAsync) {
      throw "Not supported";
    }
    lines.push(`<script src="${graph.getNodeURL(out)}" type="module"></script>`);
  });

  lines.push(`<script type="module">window.parent.postMessage("start ${node.index}", "*");</script>`);

  // todo: async imports would come here

  lines.push(`<script type="module">window.parent.postMessage("finish ${node.index}", "*");</script>`);
  lines.push(`<script type="module">window.parent.postMessage("loaded", "*");</script>`);

  return lines.join("\n");
}

function buildModuleSource(graph, node) {
  if (node.isRoot) {
    throw "Can't get module source for root page";
  }

  let lines = [
    `window.parent.postMessage("start ${node.index}", "*");`
  ];

  if (node.isError) {
    lines.push(`throw new Error("${node.moduleName}");`);
  }

  if (node.isAsync) {
    lines.push(`await 0;`);
  }

  node.forEachOutgoingEdge((out, isAsync) => {
    let url = graph.getNodeURL(out);
    if (isAsync) {
      lines.push(`await import("${url}");`);
    } else {
      lines.push(`import {} from "${url}";`);
    }
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
      ({ statusCode, mimeType, stream } = await handleGeneatedFile(req.url));
    } else {
      ({ statusCode, mimeType, stream } = await handleStaticFile(req.url));
    }
  } catch (error) {
    if (error instanceof NotFoundError) {
      statusCode = 404;
      stream = Readable.from("File not found: " + req.url,
                             {encoding: 'utf8'});
    } else {
      statusCode = 500;
      stream = Readable.from("Internal server error: " + error,
                             {encoding: 'utf8'});
    }
  }

  console.log(`${req.method} ${req.url} => ${statusCode}`);
  res.writeHead(statusCode, {
    "Content-Type": mimeType,
    "Access-Control-Allow-Origin": "*"
  });
  stream.pipe(res);
}).listen(PORT);

console.log(`Server running at http://127.0.0.1:${PORT}/`);
