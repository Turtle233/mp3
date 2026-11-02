const express = require("express");
const mongoose = require("mongoose");
const Task = require("../models/task");
const User = require("../models/user");
const { fail, nonEmptyString, findById, readRoutes } = require("./error_handler");

const router = express.Router();
readRoutes(router, Task, 100);

async function saveTask(body, task, session) {
  const {
    name, deadline, description = "", completed = false,
    assignedUser = "", assignedUserName,
  } = body || {};

  if (!nonEmptyString(name) ||
      !["string", "number"].includes(typeof deadline) ||
      !Number.isFinite(new Date(deadline).getTime())) {
    fail(400, "A name and a valid deadline are required");
  }
  if (typeof description !== "string" || typeof completed !== "boolean" ||
      typeof assignedUser !== "string" ||
      (assignedUserName !== undefined && typeof assignedUserName !== "string")) {
    fail(400, "Description and assignment must be strings; completed must be a boolean");
  }
  if (assignedUser && !mongoose.isObjectIdOrHexString(assignedUser)) {
    fail(400, "Assigned user must be a valid user ID");
  }

  const user = assignedUser ? await User.findById(assignedUser).session(session) : null;
  if (assignedUser && !user) fail(404, "User not found");
  const userName = user ? user.name : "unassigned";
  if (assignedUserName !== undefined && assignedUserName !== userName) {
    fail(400, "Assigned user name does not match the assigned user");
  }

  task.set({
    name, deadline: new Date(deadline), description, completed,
    assignedUser: user ? user.id : "", assignedUserName: userName,
  });
  await task.save({ session });

  await User.updateMany(
    { pendingTasks: task.id },
    { $pull: { pendingTasks: task.id } },
    { session },
  );
  if (user && !completed) {
    await User.updateOne(
      { _id: user._id },
      { $addToSet: { pendingTasks: task.id } },
      { session },
    );
  }

  return task;
}

router.post("/", async function (request, response) {
  const task = await mongoose.connection.transaction(async function (session) {
    return saveTask(request.body, new Task(), session);
  });
  response.status(201).json({ message: "Task created", data: task });
});

router.put("/:id", async function (request, response) {
  const task = await mongoose.connection.transaction(async function (session) {
    const task = await findById(Task, request.params.id, session);
    return saveTask(request.body, task, session);
  });
  response.status(200).json({ message: "Task updated", data: task });
});

router.delete("/:id", async function (request, response) {
  await mongoose.connection.transaction(async function (session) {
    const task = await findById(Task, request.params.id, session);
    await User.updateMany(
      { pendingTasks: task.id },
      { $pull: { pendingTasks: task.id } },
      { session },
    );
    await task.deleteOne({ session });
  });
  response.status(200).json({ message: "Task deleted", data: null });
});

module.exports = router;
