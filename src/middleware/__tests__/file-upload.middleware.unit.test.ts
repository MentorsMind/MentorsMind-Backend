import express from "express";
import fs from "fs";
import { access } from "fs/promises";
import request from "supertest";
import {
  cleanupUploadedFile,
  createFileUpload,
} from "../file-upload.middleware";

describe("file upload middleware", () => {
  it("writes multipart uploads to disk and removes the temporary file after the response", async () => {
    const app = express();
    let uploadedPath = "";

    app.post(
      "/upload",
      createFileUpload().single("file"),
      cleanupUploadedFile,
      (req, res) => {
        const file = req.file!;
        uploadedPath = file.path;
        res.json({
          hasBuffer: "buffer" in file,
          content: fs.readFileSync(file.path, "utf8"),
        });
      },
    );

    const response = await request(app)
      .post("/upload")
      .attach("file", Buffer.from("upload content"), "upload.txt");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      hasBuffer: false,
      content: "upload content",
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await access(uploadedPath);
        await new Promise((resolve) => setTimeout(resolve, 5));
      } catch {
        return;
      }
    }

    throw new Error("Temporary upload file was not removed");
  });
});
