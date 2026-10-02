import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// A small React app for checking that URL capture finds component names and source files.
export default defineConfig({ plugins: [react()] });
