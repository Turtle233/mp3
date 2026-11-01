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

module.exports = router;
