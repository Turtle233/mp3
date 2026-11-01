// Load required packages
var mongoose = require("mongoose");

// Define task schema
var TaskSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    deadline: {
      type: Date,
      required: true,
    },
    completed: {
      type: Boolean,
      default: false,
    },
    assignedUser: {
      type: String,
      default: "",
    },
    assignedUserName: {
      type: String,
      default: "unassigned",
    },
  },
  {
    timestamps: {
      createdAt: "dateCreated",
      updatedAt: false,
    },
  },
);

// Export the Mongoose model
module.exports = mongoose.model("Task", TaskSchema);
