import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({root:"multiplayer",base:"/smash/",plugins:[react()],build:{outDir:"../multiplayer-dist/smash",emptyOutDir:true}});
