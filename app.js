const Koa = require('koa')
const Router = require('koa-router')
const app = new Koa()
const fs = require('fs')
const server = require('http').Server(app.callback())
const io = require('socket.io')(server)
const path = require('path')
var cors = require('koa2-cors')
var os = require('os')
var pty = require('node-pty')
const USE_BINARY = os.platform() !== 'win32'
const port = 8085
var terms = {},
  logs = {}
app.use(
  cors({
    origin: function(ctx) {
      return '*'
    },
    exposeHeaders: ['WWW-Authenticate', 'Server-Authorization'],
    maxAge: 5,
    credentials: true,
    allowMethods: ['GET', 'POST', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization', 'Accept']
  })
)

// 首页路由
let router = new Router()
router.get('/', async (ctx, next) => {
  ctx.response.type = 'html'
  ctx.response.body = fs.createReadStream('./index.html')
  await next()
})
router.post('/term', async (ctx, next) => {
  const env = Object.assign({}, process.env)
  env['COLORTERM'] = 'truecolor'
  var cols = parseInt(ctx.request.query.cols),
    rows = parseInt(ctx.request.query.rows),
    term = pty.spawn(
      process.platform === 'win32' ? 'powershell.exe' : 'bash',
      [],
      {
        name: 'xterm-color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: env.PWD,
        env: env,
        encoding: 'utf8' //让输出的编码为utf8
      }
    )
  console.log('Created terminal with PID: ' + term.pid)
  if (!terms[term.pid]) {
    terms[term.pid] = {}
  }

  terms[term.pid].terminal = term
  terms[term.pid].writable = false
  logs[term.pid] = ''

  //返回启动的pid  用于socket连接后操作term

  ctx.response.body = {
    data: term.pid.toString(),
    code: 200,
    message: 'success'
  }
  //创建的时候 保存初始化terminal数据  以便socket连接后前端显示  并且判断初始化语句 以便判断语句执行完毕使用
  term.on('data', data => {
    logs[term.pid] += data
    terms[parseInt(term.pid)].initCode = data
    // if (!terms[parseInt(term.pid)].initCode) {

    // }
  })
  //ctx.response.body = 'test'
  await next()
})
app.use(router.routes())

io.of('/termsocket').on('connection', socket => {
  var pid = parseInt(socket.request._query.pid)
  if (!terms || !terms[pid]) {
    return
  }
  console.log(terms[pid].initCode)
  //socket连接根据pid操作对应的terminal
  var term = terms[pid].terminal

  //把存起来的初始化数据发送给前端展示
  socket.send(logs[term.pid])
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

  //监听terminal输出数据  通过socket发送给前端展示
  term.on('data', function(data) {
    if (terms[pid].initCode && data == terms[pid].initCode) {
      //   if (terms[pid].filepath && terms[pid].filepath.length > 0) {
      //     fs.unlinkSync(terms[pid].filepath);
      //     terms[pid].filepath = null;
      //   }

      terms[pid].writable = false
    }
    console.log('data:', data)
    try {
      socket.send(data)
      //buffer(socket, 5);
      //socket.send(USE_BINARY ? data.toString("utf8") : data);
      //send(data);
    } catch (ex) {
      // The WebSocket is not open, ignore
    }
  })

  socket.on('message', data => {
    if (terms[pid].writable) term.write(data)
  })
  socket.on('leftmessage', data => {
    // let name = path.join(
    //   __dirname,
    //   'file/' +
    //     new Date().getTime() +
    //     '_' +
    //     parseInt((Math.random() * 100000).toString(), 10) +
    //     '.py'
    // )
    // let newData = data;
    // fs.writeFileSync(name, newData, {
    //   encoding: "utf8"
    // });
    // terms[pid].filepath = name;
    if (!terms[pid].writable) {
      terms[pid].writable = true
    }
    term.write(`python ${data}\r`)
  })
  //socket关闭的时候关闭term
  socket.on('close', () => {
    console.log('terminal关闭PID:' + socket.request._query.pid)
    if (terms[pid].filepath && terms[pid].filepath.length > 0) {
      fs.unlinkSync(terms[pid].filepath)
      terms[pid].filepath = null
    }
    term.destroy()
    term.kill()
    delete terms[term.pid]
    delete logs[term.pid]
  })
})

io.close(() => {
  for (let key in terms) {
    if (terms[key].filepath && terms[key].filepath.length > 0) {
      fs.unlinkSync(terms[key].filepath)
      terms[key].filepath = null
    }
    terms[key].destroy()
    term[key].kill()
  }
  delete terms
  delete logs
})
// 监听端口
server.listen(process.env.PORT || port, () => {
  console.log(`app run at : http://127.0.0.1/:${port}`)
})
