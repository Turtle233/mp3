const express = require("express");
const User = require("../models/user");

const router = express.Router();

router.get("/", async function (request, response) {
  try {
    const users = await User.find({});
    response.status(200).json({
      message: "OK",
      data: users,
    });
  } catch (err) {
    response.status(500).json({
      message: "Failed to retrieve Users",
      data: null,
    });
  }
});

// POST /api/users
router.post("/", async function (request, response) {
  try {
    const { name, email } = request.body || {};

    if (typeof name !== "string" || !name.trim() || typeof email !== "string" || !email.trim()) {
      return response.status(400).json({
        message: "Name and email must be non-empty strings",
        data: null,
      });
    }

    const user = await User.create({ name, email });

    return response.status(201).json({
      message: "User created",
      data: user,
    });
  } catch (err) {
    // 11100 means duplicated
    if (err.code === 11000) {
      return response.status(400).json({
        message: "Email is already in use",
        data: null,
      });
    }

    console.error(err.message);

    return response.status(500).json({
      message: "Failed to create user",
      data: null,
    });
  }
});

module.exports = router;
