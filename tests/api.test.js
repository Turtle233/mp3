const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const net = require("node:net");
const path = require("node:path");
const mongoose = require("mongoose");
const User = require("../models/user");
const Task = require("../models/task");

require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });

const databaseName = "mp3_test_" + new mongoose.Types.ObjectId();
const missingId = new mongoose.Types.ObjectId().toString();
const deadline = "2026-11-03T12:00:00.000Z";
let server;
let baseUrl;

before(async function () {
  const uri = new URL(process.env.MONGODB_URI);
  uri.pathname = "/" + databaseName;
  await mongoose.connect(uri.toString(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([User.init(), Task.init()]);

  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  baseUrl = "http://127.0.0.1:" + port + "/api";
  server = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, MONGODB_URI: uri.toString(), PORT: String(port) },
    stdio: "ignore",
    windowsHide: true,
  });

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not start");
});

after(async function () {
  if (server && server.exitCode === null) {
    const closed = once(server, "exit");
    server.kill();
    await closed;
  }
  if (mongoose.connection.readyState === 1) {
    // Only the randomly named database created for this test run is removed.
    assert.equal(mongoose.connection.name, databaseName);
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
});

async function request(method, endpoint, body, status = method === "DELETE" ? 204 : 200) {
  const response = await fetch(baseUrl + endpoint, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (status === 204) {
    assert.equal(response.status, 204, method + " " + endpoint);
    assert.equal(await response.text(), "");
    return;
  }
  const result = await response.json();
  assert.equal(response.status, status, method + " " + endpoint + ": " + result.message);
  assert.equal(typeof result.message, "string");
  assert.ok(Object.hasOwn(result, "data"));
  return result.data;
}

function query(values) {
  return "?" + new URLSearchParams(
    Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]),
  );
}

function createUser(name) {
  return request("POST", "/users", { name, email: name + "@test.com" }, 201);
}

function createTask(name, fields = {}) {
  return request("POST", "/tasks", { name, deadline, ...fields }, 201);
}

test("creation defaults, required fields and strict input types", async function () {
  const user = await createUser("  Alice  ");
  assert.equal(user.name, "Alice");
  assert.deepEqual(user.pendingTasks, []);
  assert.ok(user.dateCreated);
  await request("POST", "/users", { name: "Duplicate", email: user.email }, 400);
  for (const body of [{}, { name: 1, email: "a" }, { name: "a", email: null },
    { name: "a", email: "b", pendingTasks: null },
    { name: "a", email: "b", pendingTasks: ["bad"] }]) {
    await request("POST", "/users", body, 400);
  }

  const task = await createTask("  First  ", { dateCreated: "2000-01-01" });
  assert.equal(task.name, "First");
  assert.equal(task.description, "");
  assert.equal(task.completed, false);
  assert.equal(task.assignedUser, "");
  assert.equal(task.assignedUserName, "unassigned");
  assert.notEqual(task.dateCreated.slice(0, 4), "2000");
  for (const fields of [{ name: "" }, { deadline: null }, { deadline: "bad" },
    { deadline: true }, { completed: "true" }, { description: 42 },
    { assignedUser: "bad" }, { assignedUserName: 42 }]) {
    await request("POST", "/tasks", { name: "Invalid", deadline, ...fields }, 400);
  }
});

test("missing URL resources take priority over invalid body fields", async function () {
  for (const resource of ["users", "tasks"]) {
    for (const id of ["bad", missingId]) {
      await request("GET", "/" + resource + "/" + id, undefined, 404);
      await request("PUT", "/" + resource + "/" + id, {}, 404);
      await request("DELETE", "/" + resource + "/" + id, undefined, 404);
    }
  }
});

test("POST assignment, validation failures and user-driven task transfer", async function () {
  const first = await createUser("Owner");
  const task = await createTask("Transfer", { assignedUser: first._id });
  assert.equal(task.assignedUserName, first.name);
  assert.deepEqual((await request("GET", "/users/" + first._id)).pendingTasks, [task._id]);
  await request("POST", "/tasks", { name: "Missing", deadline, assignedUser: missingId }, 404);
  await request("POST", "/tasks", {
    name: "Mismatch", deadline, assignedUser: first._id, assignedUserName: "Wrong",
  }, 400);
  const done = await createTask("Done", { completed: true, assignedUser: first._id });
  await request("POST", "/users", { name: "Invalid", email: "invalid@test.com", pendingTasks: [done._id] }, 400);
  await request("POST", "/users", { name: "Missing", email: "missing@test.com", pendingTasks: [missingId] }, 404);

  const second = await request("POST", "/users", {
    name: "New owner", email: "new@test.com", pendingTasks: [task._id.toUpperCase(), task._id],
  }, 201);
  assert.deepEqual(second.pendingTasks, [task._id]);
  assert.deepEqual((await request("GET", "/users/" + first._id)).pendingTasks, []);
  assert.equal((await request("GET", "/tasks/" + task._id)).assignedUser, second._id);

  const renamed = await request("PUT", "/users/" + first._id, { name: "Renamed", email: first.email });
  assert.equal(renamed.dateCreated, first.dateCreated);
  assert.equal((await request("GET", "/tasks/" + done._id)).assignedUserName, "Renamed");

  await request("PUT", "/users/" + first._id, {
    name: "Renamed", email: first.email, pendingTasks: [task._id],
  });
  assert.deepEqual((await request("GET", "/users/" + second._id)).pendingTasks, []);
  await request("PUT", "/users/" + first._id, { name: "Renamed", email: first.email });
  assert.equal((await request("GET", "/tasks/" + task._id)).assignedUser, "");
});

test("task PUT completion, reassignment, reopening and full replacement", async function () {
  const first = await createUser("TaskOwner1");
  const second = await createUser("TaskOwner2");
  const task = await createTask("State", { assignedUser: first._id, description: "Old" });
  await request("PUT", "/tasks/" + task._id, {
    name: "State", deadline, completed: true, assignedUser: first._id,
  });
  assert.deepEqual((await request("GET", "/users/" + first._id)).pendingTasks, []);
  await request("PUT", "/tasks/" + task._id, {
    name: "State", deadline, completed: true, assignedUser: second._id,
  });
  assert.deepEqual((await request("GET", "/users/" + second._id)).pendingTasks, []);
  await request("PUT", "/tasks/" + task._id, { name: "State", deadline, assignedUser: second._id });
  assert.deepEqual((await request("GET", "/users/" + second._id)).pendingTasks, [task._id]);
  const replaced = await request("PUT", "/tasks/" + task._id, {
    name: "Replaced", deadline, dateCreated: "2000-01-01",
  });
  assert.equal(replaced.dateCreated, task.dateCreated);
  assert.equal(replaced.description, "");
  assert.equal(replaced.completed, false);
  assert.equal(replaced.assignedUser, "");
  assert.equal(replaced.assignedUserName, "unassigned");
  assert.deepEqual((await request("GET", "/users/" + second._id)).pendingTasks, []);
});

test("failed PUT requests leave users and tasks unchanged", async function () {
  const user = await createUser("Stable");
  const task = await createTask("StableTask", { assignedUser: user._id });
  const beforeUser = await request("GET", "/users/" + user._id);
  const beforeTask = await request("GET", "/tasks/" + task._id);
  await request("PUT", "/users/" + user._id, { name: "Changed", email: user.email, pendingTasks: [missingId] }, 404);
  await request("PUT", "/users/" + user._id, { name: "Changed", email: "new@test.com" }, 400);
  await request("PUT", "/tasks/" + task._id, { name: "Changed", deadline, assignedUser: missingId }, 404);
  await request("PUT", "/tasks/" + task._id, {
    name: "Changed", deadline, assignedUser: user._id, assignedUserName: "Wrong",
  }, 400);
  assert.deepEqual(await request("GET", "/users/" + user._id), beforeUser);
  assert.deepEqual(await request("GET", "/tasks/" + task._id), beforeTask);
});

test("database failure rolls back earlier writes without leaking internal errors", async function () {
  const user = await createUser("RollbackOwner");
  const task = await createTask("RollbackTask", { assignedUser: user._id });
  const beforeUser = await request("GET", "/users/" + user._id);
  const beforeTask = await request("GET", "/tasks/" + task._id);
  // The user save succeeds first, then this validator rejects the task update.
  await mongoose.connection.db.command({
    collMod: "tasks", validator: { name: { $ne: "RollbackTask" } },
  });
  try {
    const response = await fetch(baseUrl + "/users/" + user._id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Changed", email: user.email, pendingTasks: [task._id] }),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { message: "Unable to complete request", data: null });
    assert.deepEqual(await request("GET", "/users/" + user._id), beforeUser);
    assert.deepEqual(await request("GET", "/tasks/" + task._id), beforeTask);
  } finally {
    await mongoose.connection.db.command({ collMod: "tasks", validator: {} });
  }
});

test("collection queries, count, default limits and select on single resources", async function () {
  await Task.insertMany(Array.from({ length: 105 }, (_, i) => ({
    name: "Query" + String(i).padStart(3, "0"), deadline,
  })));
  await User.insertMany(Array.from({ length: 101 }, (_, i) => ({ name: "Bulk" + i, email: "bulk" + i + "@test.com" })));
  const where = { name: { $regex: "^Query" } };
  const tasks = await request("GET", "/tasks" + query({
    where, sort: { name: -1 }, select: { name: 1, _id: 0 }, skip: 2, limit: 2,
  }));
  assert.deepEqual(tasks, [{ name: "Query102" }, { name: "Query101" }]);
  assert.equal(await request("GET", "/tasks" + query({ where, count: true, limit: 2 })), 105);
  assert.equal((await request("GET", "/tasks" + query({ where }))).length, 100);
  assert.equal((await request("GET", "/tasks" + query({ where, limit: 0 }))).length, 105);
  assert.ok((await request("GET", "/users")).length > 100);
  assert.deepEqual(await request("GET", "/tasks" + query({ where: { name: "NoSuchName" } })), []);
  assert.equal(await request("GET", "/tasks" + query({ where: { name: "NoSuchName" }, count: true })), 0);

  for (const resource of ["users", "tasks"]) {
    const [document] = await request("GET", "/" + resource + "?limit=1");
    assert.deepEqual(await request("GET", "/" + resource + "/" + document._id +
      query({ select: { name: 1, _id: 0 } }) + "&where=bad&count=bad"), { name: document.name });
    for (const parameter of ["where", "sort", "select", "skip", "limit", "count"]) {
      await request("GET", "/" + resource + "?" + parameter + "=bad", undefined, 400);
    }
    await request("GET", "/" + resource + "/" + document._id + "?select=bad", undefined, 400);
  }
});

test("concurrent task assignments preserve both directions", async function () {
  const first = await createUser("Concurrent1");
  const second = await createUser("Concurrent2");
  const task = await createTask("Concurrent");
  await Promise.all([first, second].map(user => request("PUT", "/tasks/" + task._id, {
    name: "Concurrent", deadline, assignedUser: user._id,
  })));
  const saved = await request("GET", "/tasks/" + task._id);
  for (const user of [first, second]) {
    assert.deepEqual((await request("GET", "/users/" + user._id)).pendingTasks,
      saved.assignedUser === user._id ? [task._id] : []);
  }
});

test("deletes return empty 204 responses and clean up pending and completed task references", async function () {
  const user = await createUser("DeleteOwner");
  const pending = await createTask("DeletePending", { assignedUser: user._id });
  const completed = await createTask("DeleteCompleted", { assignedUser: user._id, completed: true });
  await request("DELETE", "/tasks/" + pending._id);
  assert.deepEqual((await request("GET", "/users/" + user._id)).pendingTasks, []);
  await request("GET", "/tasks/" + pending._id, undefined, 404);
  const remaining = await createTask("Remaining", { assignedUser: user._id });
  await request("DELETE", "/users/" + user._id);
  await request("GET", "/users/" + user._id, undefined, 404);
  for (const task of [completed, remaining]) {
    const saved = await request("GET", "/tasks/" + task._id);
    assert.equal(saved.assignedUser, "");
    assert.equal(saved.assignedUserName, "unassigned");
  }
});

test("malformed JSON, unknown routes and CORS preflight", async function () {
  const response = await fetch(baseUrl + "/users", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "Invalid request data or query", data: null });
  await request("GET", "/unknown", undefined, 404);
  const preflight = await fetch(baseUrl + "/tasks", { method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  assert.equal(await preflight.text(), "");
});
