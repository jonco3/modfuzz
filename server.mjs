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
  let parts = req.url.split("/").slice(2);
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
    data = node.buildPageSource(); // todo
  } else {
    mimeType = "text/javascript";
    data = node.buildModuleSource(); // todo
  }

  let stream = Readable.from(data, {encoding: 'utf8'});
  return { statusCode: 200, mimeType, stream };
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
  res.writeHead(statusCode, { "Content-Type": mimeType });
  stream.pipe(res);
}).listen(PORT);

console.log(`Server running at http://127.0.0.1:${PORT}/`);
