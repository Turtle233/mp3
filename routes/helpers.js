const mongoose = require("mongoose");

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

async function findById(Model, id, session = null, select = {}) {
  if (!mongoose.isObjectIdOrHexString(id)) {
    fail(404, Model.modelName + " not found");
  }

  const document = await Model.findById(id).select(select).session(session);
  if (!document) fail(404, Model.modelName + " not found");
  return document;
}

function parse(value, fallback) {
  return value === undefined ? fallback : JSON.parse(value);
}

function objectParameter(value) {
  const result = parse(value, {});
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    fail(400, "Query parameter must be a JSON object");
  }
  return result;
}

function readRoutes(router, Model, defaultLimit = 0) {
  router.get("/", async function (request, response) {
    const where = objectParameter(request.query.where);
    const sort = objectParameter(request.query.sort);
    const select = objectParameter(request.query.select);
    const skip = parse(request.query.skip, 0);
    const limit = parse(request.query.limit, defaultLimit);
    const count = parse(request.query.count, false);

    if (!Number.isInteger(skip) || skip < 0 ||
        !Number.isInteger(limit) || limit < 0 || typeof count !== "boolean") {
      fail(400, "Skip and limit must be non-negative integers; count must be a boolean");
    }

    const data = count
      ? await Model.countDocuments(where)
      : await Model.find(where).sort(sort).select(select).skip(skip).limit(limit);

    response.status(200).json({ message: "OK", data });
  });

  router.get("/:id", async function (request, response) {
    const select = objectParameter(request.query.select);
    const data = await findById(Model, request.params.id, null, select);

    response.status(200).json({ message: "OK", data });
  });
}

function errorHandler(err, request, response, next) {
  if (err.code === 11000) {
    return response.status(400).json({ message: "Email is already in use", data: null });
  }

  if (["SyntaxError", "ValidationError", "CastError"].includes(err.name)) {
    return response.status(400).json({ message: "Invalid request data or query", data: null });
  }

  const status = err.status || 500;
  response.status(status).json({
    message: status === 500 ? "Unable to complete request" : err.message,
    data: null,
  });
}

module.exports = { fail, nonEmptyString, findById, readRoutes, errorHandler };
