const Koa = require("koa");
const Router = require("koa-router");
const app = new Koa();
const fs = require("fs");
const server = require("http").Server(app.callback());
const io = require("socket.io")(server);
const path = require("path");
var cors = require("koa2-cors");
var os = require("os");
var pty = require("node-pty");
const USE_BINARY = os.platform() !== "win32";
const port = 8085;
var terms = {},
  logs = {};
app.use(
  cors({
    origin: function(ctx) {
      return "*";
    },
    exposeHeaders: ["WWW-Authenticate", "Server-Authorization"],
    maxAge: 5,
    credentials: true,
    allowMethods: ["GET", "POST", "DELETE"],
    allowHeaders: ["Content-Type", "Authorization", "Accept"]
  })
);

// 首页路由
let router = new Router();
router.get("/", ctx => {
  ctx.response.type = "html";
  ctx.response.body = fs.createReadStream("./index.html");
});
router.post("/term", async (ctx, next) => {
  const env = Object.assign({}, process.env);
  env["COLORTERM"] = "truecolor";
  var cols = parseInt(ctx.request.query.cols),
    rows = parseInt(ctx.request.query.rows),
    term = pty.spawn(
      process.platform === "win32" ? "powershell.exe" : "bash",
      [],
      {
        name: "xterm-color",
        cols: cols || 80,
        rows: rows || 24,
        cwd: env.PWD,
        env: env,
        encoding: "utf8"
      }
    );

  console.log("Created terminal with PID: " + term.pid);
  if (!terms[term.pid]) {
    terms[term.pid] = {};
  }

  terms[term.pid].terminal = term;
  terms[term.pid].writable = false;
  logs[term.pid] = "";

  ctx.response.body = {
    data: term.pid.toString(),
    code: 200,
    message: "success"
  };

  term.on("data", data => {
    logs[term.pid] += data;
    if (!terms[parseInt(term.pid)].initCode) {
      terms[parseInt(term.pid)].initCode = data;
    }
  });

  await next();
});
app.use(router.routes());

io.of("/termsocket").on("connection", socket => {
  if (!terms || !terms[parseInt(socket.request._query.pid)]) {
    return;
  }
  var term = terms[parseInt(socket.request._query.pid)].terminal;
  socket.send(logs[term.pid]);
  //   function buffer(socket, timeout) {
  //     let s = "";
  //     let sender = null;
  //     return data => {
  //       s += data;
  //       if (!sender) {
  //         sender = setTimeout(() => {
  //           socket.send(s);
  //           s = "";
  //           sender = null;
  //         }, timeout);
  //       }
  //     };
  //   }

  //   function bufferUtf8(socket, timeout) {
  //     let buffer = [];
  //     let sender = null;
  //     let length = 0;
  //     return data => {
  //       buffer.push(data);
  //       length += data.length;
  //       if (!sender) {
  //         sender = setTimeout(() => {
  //           let data = Buffer.concat(buffer, length).toString("utf8");
  //           data = terms[parseInt(socket.request._query.pid)].writable
  //             ? data
  //             : data.replace("process_over", "");
  //           socket.send(data);
  //           buffer = [];
  //           sender = null;
  //           length = 0;
  //         }, timeout);
  //       }
  //     };
  //   }
  //   const send = USE_BINARY ? bufferUtf8(socket, 5) : buffer(socket, 5);
  term.on("data", function(data) {
    if (
      terms[parseInt(socket.request._query.pid)].initCode &&
      data == terms[parseInt(socket.request._query.pid)].initCode
    ) {
      if (
        terms[parseInt(socket.request._query.pid)].filepath &&
        terms[parseInt(socket.request._query.pid)].filepath.length > 0
      ) {
        fs.unlinkSync(terms[parseInt(socket.request._query.pid)].filepath);
        terms[parseInt(socket.request._query.pid)].filepath = null;
      }

      terms[parseInt(socket.request._query.pid)].writable = false;
    }
    try {
      socket.send(data);
      //buffer(socket, 5);
      //socket.send(USE_BINARY ? data.toString("utf8") : data);
      //send(data);
    } catch (ex) {
      // The WebSocket is not open, ignore
    }
  });
  socket.on("message", data => {
    if (terms[parseInt(socket.request._query.pid)].writable) term.write(data);
  });
  socket.on("leftmessage", data => {
    let name = path.join(
      __dirname,
      "file/" +
        new Date().getTime() +
        "_" +
        parseInt((Math.random() * 100000).toString(), 10) +
        ".py"
    );
    let newData = data;
    fs.writeFileSync(name, newData, {
      encoding: "utf8"
    });
    terms[parseInt(socket.request._query.pid)].filepath = name;
    if (!terms[parseInt(socket.request._query.pid)].writable) {
      terms[parseInt(socket.request._query.pid)].writable = true;
    }
    term.write(`python ${name}\r`);
  });
  socket.on("close", () => {
    console.log("terminal关闭PID:" + socket.request._query.pid);
    if (
      terms[parseInt(socket.request._query.pid)].filepath &&
      terms[parseInt(socket.request._query.pid)].filepath.length > 0
    ) {
      fs.unlinkSync(terms[parseInt(socket.request._query.pid)].filepath);
      terms[parseInt(socket.request._query.pid)].filepath = null;
    }
    term.destroy();
    term.kill();
    delete terms[term.pid];
    delete logs[term.pid];
  });
});

// 监听端口
server.listen(process.env.PORT || port, () => {
  console.log(`app run at : http://127.0.0.1/:${port}`);
});
