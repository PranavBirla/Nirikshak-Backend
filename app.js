const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

const multer = require("multer");

const { analyzeImage } = require("./src/ocr");
const { extractFields } = require("./src/extractor3");
const { checkCompliance } = require("./src/rules");

const upload = multer({
  dest: path.join(__dirname, "uploads"),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  }
});

const app = express();
const PORT = 3000;

app.use(cors());

app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.send("Hello from Nirikshak 1.0! Use the /api/ocr endpoint to perform OCR on the sample image.");
});

app.post("/api/ocr", upload.single("image"), async (req, res) => {
  let imagePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image uploaded"
      });
    }

    imagePath = req.file.path;

    console.log("Received image:", req.file.originalname);

    const ocrResult = await analyzeImage(imagePath);

    const fields = extractFields(
      ocrResult.words
    );

    const compliance = checkCompliance(
      fields
    );

    res.json({
      success: true,
      fields,
      compliance
    });

  } catch (error) {
    console.error("OCR error:", error);

    res.status(500).json({
      success: false,
      message: "OCR processing failed"
    });

  } finally {
    // Delete temporary image after processing
    if (imagePath) {
      fs.unlink(imagePath, (error) => {
        if (error) {
          console.error(
            "Failed to delete temporary image:",
            error.message
          );
        }
      });
    }
  }
});


app.listen(PORT, () => {
  console.log(`Nirikshak 1.0 running on http://localhost:${PORT}`);
});