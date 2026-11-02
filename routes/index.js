/*
 * Connect all of your endpoints together here.
 */
module.exports = function (app, router) {
  app.use("/api", require("./home.js")(router));
  app.use("/api/users", require("./user.js"));
  app.use("/api/tasks", require("./task.js"));
  app.use(function (request, response) {
    response.status(404).json({ message: "Route not found", data: null });
  });
  app.use(require("./error_handler").errorHandler);
};
