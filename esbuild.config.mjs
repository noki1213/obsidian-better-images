import esbuild from "esbuild";
import process from "process";

esbuild.build({
	entryPoints: ["main.ts"],
	bundle: true,
	external: ["obsidian"],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: "inline",
	treeShaking: true,
	outfile: "main.js",
}).catch(() => process.exit(1));
