#!/usr/bin/env python3
"""Scaffold templates for additional project kinds."""

import html


def node_package_json(name):
    return f"""{{
  "name": "{name}",
  "version": "0.1.0",
  "private": true,
  "scripts": {{
    "start": "node server.js"
  }},
  "dependencies": {{
    "express": "^4.21.2"
  }}
}}
"""


def node_server_js(name):
    escaped = html.escape(name)
    return f"""const express = require("express");

const app = express();
const port = process.env.PORT || 3000;

app.get("/healthz", (_req, res) => {{
  res.type("text/plain").send("ok\\n");
}});

app.get("/", (_req, res) => {{
  res.type("html").send(`<!doctype html><title>{escaped}</title><h1>Welcome to {escaped}</h1>`);
}});

app.listen(port, "0.0.0.0", () => {{
  console.log(`{escaped} listening on ${{port}}`);
}});
"""


def node_dockerfile():
    return """FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
"""


def python_app_py(name):
    escaped = html.escape(name)
    return f"""from flask import Flask

app = Flask(__name__)


@app.get("/healthz")
def healthz():
    return "ok\\n", 200, {{"Content-Type": "text/plain"}}


@app.get("/")
def home():
    return f\"\"\"<!doctype html><title>{escaped}</title><h1>Welcome to {escaped}</h1>\"\"\"


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(__import__("os").environ.get("PORT", "8000")))
"""


def python_requirements():
    return "flask==3.1.0\ngunicorn==23.0.0\n"


def python_dockerfile():
    return """FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["gunicorn", "-b", "0.0.0.0:8000", "app:app"]
"""
