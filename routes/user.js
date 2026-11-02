const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/user");
const Task = require("../models/task");
const { fail, nonEmptyString, findById, readRoutes } = require("./helpers");

const router = express.Router();
readRoutes(router, User);

async function saveUser(body, user, session) {
  const { name, email, pendingTasks = [] } = body || {};

  if (!nonEmptyString(name) || !nonEmptyString(email)) {
    fail(400, "Name and email must be non-empty strings");
  }
  if (!Array.isArray(pendingTasks) ||
      pendingTasks.some(id => !mongoose.isObjectIdOrHexString(id))) {
    fail(400, "Pending tasks must be an array of valid task IDs");
  }
  if (await User.exists({ email, _id: { $ne: user._id } }).session(session)) {
    fail(400, "Email is already in use");
  }

  const taskIds = [...new Set(pendingTasks.map(id => id.toLowerCase()))];
  const tasks = await Task.find({ _id: { $in: taskIds } }).session(session);
  if (tasks.some(task => task.completed)) {
    fail(400, "Completed tasks cannot be pending");
  }
  if (tasks.length !== taskIds.length) fail(404, "Task not found");

  const removed = user.pendingTasks.filter(id => !taskIds.includes(id));
  user.set({ name, email, pendingTasks: taskIds });
  await user.save({ session });

  await Task.updateMany(
    { _id: { $in: removed } },
    { $set: { assignedUser: "", assignedUserName: "unassigned" } },
    { session },
  );
  await User.updateMany(
    { _id: { $ne: user._id }, pendingTasks: { $in: taskIds } },
    { $pull: { pendingTasks: { $in: taskIds } } },
    { session },
  );
  // This also updates the names on completed tasks when the user is renamed.
  await Task.updateMany(
    { $or: [{ _id: { $in: taskIds } }, { assignedUser: user.id }] },
    { $set: { assignedUser: user.id, assignedUserName: user.name } },
    { session },
  );

  return user;
}

router.post("/", async function (request, response) {
  const user = await mongoose.connection.transaction(async function (session) {
    return saveUser(request.body, new User(), session);
  });
  response.status(201).json({ message: "User created", data: user });
});

router.put("/:id", async function (request, response) {
  const user = await mongoose.connection.transaction(async function (session) {
    const user = await findById(User, request.params.id, session);
    return saveUser(request.body, user, session);
  });
  response.status(200).json({ message: "User updated", data: user });
});

router.delete("/:id", async function (request, response) {
  await mongoose.connection.transaction(async function (session) {
    const user = await findById(User, request.params.id, session);
    await Task.updateMany(
      { assignedUser: user.id },
      { $set: { assignedUser: "", assignedUserName: "unassigned" } },
      { session },
    );
    await user.deleteOne({ session });
  });
  response.status(200).json({ message: "User deleted", data: null });
});

module.exports = router;
