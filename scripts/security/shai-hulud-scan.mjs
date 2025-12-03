#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const lifecycleKeys = ["preinstall", "install", "postinstall", "prepare"];
const suspiciousPatterns = [
  /shai\s*hulud/i,
  /wget\s+/i,
  /curl\s+/i,
  /\|\s*(sh|bash)/i,
  /Invoke-WebRequest/i,
  /powershell/i,
];

const filesToCheck = [
  "package.json",
  path.join("backend", "package.json"),
  path.join("storefront", "package.json"),
  "pnpm-lock.yaml",
  ".npmrc",
];

const issues = [];

const loadJson = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    issues.push(`Failed to read ${filePath}: ${error.message}`);
    return null;
  }
};

const checkPackageJson = (filePath) => {
  const data = loadJson(filePath);
  if (!data) {
    return;
  }

  const pkgName = data.name ?? filePath;

  // Detect lifecycle scripts with suspicious shells or remote fetches.
  for (const key of lifecycleKeys) {
    const script = data.scripts?.[key];
    if (!script) continue;

    if (suspiciousPatterns.some((pattern) => pattern.test(script))) {
      issues.push(
        `${pkgName}: suspicious ${key} script -> ${script.slice(0, 200)}`
      );
    }
  }

  // Detect suspiciously named packages.
  const allDeps = {
    ...data.dependencies,
    ...data.devDependencies,
    ...data.optionalDependencies,
  };

  for (const depName of Object.keys(allDeps)) {
    if (/shai|hulud/i.test(depName)) {
      issues.push(`${pkgName}: suspicious dependency name "${depName}"`);
    }
  }
};

const checkTextFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const content = fs.readFileSync(filePath, "utf8");
  if (suspiciousPatterns.some((pattern) => pattern.test(content))) {
    issues.push(`${filePath}: contains suspicious pattern`);
  }
};

for (const relative of filesToCheck) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    continue;
  }

  if (absolute.endsWith("package.json")) {
    checkPackageJson(absolute);
  } else {
    checkTextFile(absolute);
  }
}

if (issues.length > 0) {
  console.error("Shai Hulud scan detected potential issues:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Shai Hulud scan: no suspicious patterns detected.");
