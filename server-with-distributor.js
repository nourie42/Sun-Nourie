import express from "express";
import http from "http";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { registerDistributorResearchRoutes } from "./src/distributorResearch.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_PORT = Number(process.env