import express from "express";
import { securityHeaders } from "../server/security.ts";

const app = express();

app.use(securityHeaders(false));
app.use(express.static("web/dist"));

app.listen(3000, "127.0.0.1");
