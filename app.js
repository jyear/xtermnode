const Koa = require('koa')
const Router = require('koa-router')
const app = new Koa()
const fs = require('fs')
const server = require('http').Server(app.callback())
const io = require('socket.io')(server)
const path = require('path')
const cors = require('koa2-cors')
const os = require('os')
const CronJob = require('cron').CronJob
const { spawn, exec } = require('child_process')
//var process = require('process')
//var Docker = require('dockerode')

function deleteDir(path) {
  let files = []
  if (fs.existsSync(path)) {
    files = fs.readdirSync(path)
    files.forEach((file, index) => {
      let curPath = path + '/' + file
      if (fs.statSync(curPath).isDirectory()) {
        deleteDir(curPath) //递归删除文件夹
      } else {
        fs.unlinkSync(curPath) //删除文件
      }
    })
    fs.rmdirSync(path)
  }
}

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
  // var ourDocker = new Docker();
  // ourDocker
  //   .createContainer({
  //     Tty: true,
  //     Image: "centos",
  //     Cmd: ["/bin/bash"],
  //     OpenStdin: true
  //   })
  //   .then(container => {
  //     console.log(container);
  //     return container.start();
  //   });
  const env = Object.assign({}, process.env)
  env['COLORTERM'] = 'truecolor'
  var name = path.join(__dirname, '/file', `${new Date().getTime()}`)
  fs.mkdirSync(name)
  var cols = parseInt(ctx.request.query.cols),
    rows = parseInt(ctx.request.query.rows),
    term = pty.spawn(
      process.platform === 'win32' ? 'powershell.exe' : 'docker',
      ['run', '-it', '-v', `${name}:/app`, 'own:v1', '/bin/bash'],
      {
        name: 'xterm-color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: env.HOME,
        env: env,
        encoding: 'utf8' //让输出的编码为utf8
      }
    )

  console.log('Created terminal with PID: ', term.pid)
  if (!terms[term.pid]) {
    terms[term.pid] = {}
  }
  terms[term.pid].dirName = name
  terms[term.pid].terminal = term
  terms[term.pid].writable = true
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
    if (!terms[parseInt(term.pid)].initCode) {
      terms[parseInt(term.pid)].initCode = data
      var reg = /root@(.*?)\ app/
      var regExecRes = reg.exec(data)
      console.log('获取初始值：', regExecRes)
      if (regExecRes && regExecRes[1]) {
        terms[parseInt(term.pid)].dockerContainerID = regExecRes[1]
      }
    }
  })
  await next()
})
app.use(router.routes())

io.of('/termsocket').on('connection', socket => {
  var pid = parseInt(socket.request._query.pid)
  if (!terms || !terms[pid]) {
    return
  }
  console.log('logs:', logs)
  console.log('terms:', terms)
  // console.log('socket连接时发送', logs[pid], terms[pid].initCode)

  //socket连接根据pid操作对应的terminal
  var term = terms[pid].terminal

  //把存起来的初始化数据发送给前端展示
  socket.emit('initmessage:', logs[pid])
  //监听terminal输出数据  通过socket发送给前端展示
  term.on('data', function(data) {
    if (terms[pid].initCode && data.indexOf(terms[pid].initCode) != -1) {
      terms[pid].writable = false
    }
    try {
      socket.emit('message', data)
    } catch (ex) {
      // The WebSocket is not open, ignore
    }
  })

  socket.on('message', data => {
    if (terms[pid].writable) term.write(data)
  })
  socket.on('leftmessage', data => {
    var sname =
      new Date().getTime() +
      '_' +
      parseInt((Math.random() * 100000).toString(), 10) +
      '.py'
    let name = path.join(`${terms[pid].dirName}/` + sname)
    let newData = data
    fs.writeFileSync(name, newData, {
      encoding: 'utf8'
    })
    //terms[pid].filepath = name

    if (!terms[pid].writable) {
      terms[pid].writable = true
    }
    term.write(`python3.8 /app/${sname}\r`)
  })
  //socket关闭的时候关闭term
  socket.on('close', () => {
    console.log('terminal关闭PID:' + pid)
    if (terms[pid].dirName && terms[pid].dirName.length > 0) {
      deleteDir(terms[pid].dirName)
    }
    term.destroy()
    term.kill()
    spawn('docker', ['stop', terms[pid].dockerContainerID])
    delete terms[term.pid]
    delete logs[term.pid]
  })
})

io.close(() => {
  for (let key in terms) {
    if (terms[key].dirName && terms[key].dirName.length > 0) {
      deleteDir(terms[key].dirName)
    }
    terms[key].destroy()
    term[key].kill()
    spawn('docker', ['stop', `${terms[key].dockerContainerID}`])
  }
  delete terms
  delete logs
  console.log('socket服务关闭')
})

//定时任务
new CronJob(
  '* */5 * * * *',
  () => {
    console.log('定时删除已经停止的docker容器任务')
    exec("docker rm `docker ps -a|grep Exited|awk '{print $1}'`")
  },
  null,
  true
)

// 监听端口
server.listen(process.env.PORT || port, () => {
  console.log(`app run at : http://127.0.0.1/:${port}`)
})
