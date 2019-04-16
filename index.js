const fs = require('fs');
const path = require('path');
const process = require('process');
const readline = require('readline');

const mapLimit = require('async/mapLimit');
const request = require('request');
const cheerio = require('cheerio');


Date.prototype.Format = function (fmt) {
  let o = {
    'M+': this.getMonth() + 1, //月份
    'd+': this.getDate(), //日
    'h+': this.getHours() % 12 == 0 ? 12 : this.getHours() % 12, //小时
    'H+': this.getHours(), //小时
    'm+': this.getMinutes(), //分
    's+': this.getSeconds(), //秒
    'q+': Math.floor((this.getMonth() + 3) / 3), //季度
    'S': this.getMilliseconds(), //毫秒
  };
  let week = {
    '0': '/u65e5',
    '1': '/u4e00',
    '2': '/u4e8c',
    '3': '/u4e09',
    '4': '/u56db',
    '5': '/u4e94',
    '6': '/u516d',
  };
  if (/(y+)/.test(fmt)) {
    fmt = fmt.replace(RegExp.$1, (this.getFullYear() + '').substr(4 - RegExp.$1.length));
  }
  if (/(E+)/.test(fmt)) {
    fmt = fmt.replace(RegExp.$1, ((RegExp.$1.length > 1) ? (RegExp.$1.length > 2 ? '/u661f/u671f' : '/u5468') : '') + week[this.getDay() + '']);
  }
  for (let k in o) {
    if (new RegExp('(' + k + ')').test(fmt)) {
      fmt = fmt.replace(RegExp.$1, (RegExp.$1.length == 1) ? (o[k]) : (('00' + o[k]).substr(('' + o[k]).length)));
    }
  }
  return fmt;
};

let preLineCanCover = false;

function logger(text, oneLine) {
  let oneLineMax = process.stdout.columns - 4;
  if (oneLineMax < 20) {
    process.stdout.write(`one line columns to short ${process.stdout.columns}`);
    process.exit();
  }

  text = (text || '').toString();

  if (oneLine !== true && oneLine !== false && oneLine !== undefined) {
    process.stdout.write('不在线 ( true | false | undefined)');
    process.exit();
  } else if (oneLine === true) {
    if (text.includes('\n')) {
      process.stdout.write('单行文本不能有\\n');
      process.exit();
    }

    if (text.replace(/[^\x00-\xff]/g, '01').length > oneLineMax) {
      text = text.slice(0, oneLineMax - 3);
      while (text.replace(/[^\x00-\xff]/g, '01').length > oneLineMax - 3) {
        text = text.slice(0, -1);
      }
      text += '…';
    }

    if (preLineCanCover === true) {
      process.stdout.write('\b');
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
    preLineCanCover = true;
  } else {
    preLineCanCover = false;
  }

  process.stdout.write(text);
  process.stdout.write('\n');
}

function creatSavePath(dirPath, mode) {
  if (!fs.existsSync(dirPath)) {
    let pathTmp;
    dirPath.split(path.sep).forEach((dirName) => {
      if (pathTmp) {
        pathTmp = path.join(pathTmp, dirName);
      } else {
        pathTmp = dirName;
      }
      if (!fs.existsSync(pathTmp)) {
        if (!fs.mkdirSync(pathTmp, mode)) {
          return false;
        }

      }
    });
  }
  return true;
}

function removeDirTmp(dirPath) {
  fs.readdirSync(dirPath).forEach((fileName /* , index, array */ ) => {
    let filePath = path.join(dirPath, fileName);
    let fileStat = fs.statSync(filePath);
    if (fileStat.isFile()) {
      let ext = fileName.replace(/^.*\./, '');
      if (ext === 'tmp') {
        fs.unlinkSync(filePath);
      }
    } else if (fileStat.isDirectory()) {
      removeDirTmp(filePath);
    }
  });
}



let config;
if (fs.existsSync('./config.my.js')) {
  config = require('./config.my');
} else if (fs.existsSync('./config.js')) {
  config = require('./config');
} else {
  logger('Not find config.js');
  throw new Error('Not find config.js');
}

const hostUrl = 'https://www.instagram.com';
const defMediaOccurs = 8;
config.maxMediaOccurs = config.maxMediaOccurs || defMediaOccurs;
const defTimeout = 10000;

const allSavePath = config.savePath || './';
const RETRYMAXNUM = 3;

let j = request.jar();
if (config.sessionCookie) {
  var cookie = request.cookie(`sessionid=${config.sessionCookie}`);
  j.setCookie(cookie, hostUrl);
}
let r = request.defaults({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.94 Safari/537.36',
  },
  gzip: true,
  timeout: parseInt(config.timeout) || defTimeout,
  proxy: config.proxy,
  jar: j,
  rejectUnauthorized: config.igrCAErr === true ? false : true,
});

(async () => {
  let downUsers;
  if (process.argv.length > 2) {
    downUsers = process.argv.slice(2);
  } else {
    downUsers = config.downUsers;
    if (config.userFollow) {
      let followUsers = await getFollowUsers(config.userFollow);
      for (let userName of followUsers) {
        if (!downUsers.includes(userName)) {
          downUsers.push(userName);
        }
      }
    }
  }

  if (!downUsers || downUsers.length === 0) {
    logger('找不到任何用户。');
    return false;
  }
  logger(`下载用户 ( ${downUsers.join(' | ')} )中...\n`);
  creatSavePath(allSavePath);
  removeDirTmp(allSavePath);

  let allDowns = 0,
    allMiss = 0,
    allExists = 0;
  for (let userName of downUsers) {
    let userInfo = await getUserInfo(userName);
    if (!userInfo.id) {
      logger(`用户：${userName} 的 resp.body 没有用户信息`);
      continue;
    }
    if (userInfo.media.edges.length === 0) {
      logger(`用户：${userName} 用户没有图片信息或者需要登录`);
      continue;
    }
    userInfo.userName = userName;

    // let userSavePath = path.join(allSavePath, userInfo.id + ' - ' + userName);
    let userSavePath = path.join(allSavePath, userName);
    fs.readdirSync(allSavePath).forEach((fileName /* , index, array */ ) => {
      if (new RegExp(`^${userInfo.id} - .*$`).test(fileName)) {
        if (fileName !== userInfo.id + ' - ' + userName) {
          fs.renameSync(path.join(allSavePath, fileName), userSavePath);
        }
      }
    });
    creatSavePath(userSavePath);
    userInfo.savePath = userSavePath;
    logger(`用户：${userName}  ${userInfo.id}  获取用户信息成功`);

    userInfo.localNodes = {
      len: 0,
    };
    userInfo.localSidecars = {
      len: 0,
    };
    let nodeListFile = path.join(userSavePath, '!' + userName + ' - ' + userInfo.id + '.json');
    if (fs.existsSync(nodeListFile)) {
      let localData = JSON.parse(fs.readFileSync(nodeListFile, 'utf8'));
      userInfo.localNodes = localData.localNodes;
      userInfo.localSidecars = localData.localSidecars;
    }

    await getUserAllMediaNode(userInfo);
    logger(`数据生成：!${userName} - ${userInfo.id}.json`)
    logger(`用户：${userName}  get media list (media:${userInfo.localNodes.len} + sidecar:${userInfo.localSidecars.len + userInfo.getSidecars.length})/${userInfo.media.count} success`);

    if (userInfo.getSidecars.length > 0) {
      logger(`用户：${userName}  获取 ${userInfo.getSidecars.length} 条信息正在异步下载。请等待…`);
      await getSidecarsInfo(userInfo);
    }

    fs.writeFileSync(nodeListFile, JSON.stringify({
      localNodes: userInfo.localNodes,
      localSidecars: userInfo.localSidecars,
    }, null, 4), 'utf8');
    for (let nodeId in userInfo.localNodes) {
      if (nodeId !== 'len') {
        userInfo.media.edges.push(userInfo.localNodes[nodeId]);
      }
    }
    userInfo.media.edges.sort((a, b) => {
      if (a.date < b.date) {
        return -1;
      } else {
        return 1;
      }
    });
    userInfo.mediaCount = userInfo.media.edges.length;
    logger(`用户：${userInfo.userName}  get all media info (media:${userInfo.mediaCount} + sidecar:${userInfo.localSidecars.len})/${userInfo.media.count} success`);

    userInfo.exists = 0;
    userInfo.downs = 0;
    userInfo.miss = 0;
    readAndExistsFiles(userInfo);
    logger(`用户：${userInfo.userName}  有 ${userInfo.exists}/${userInfo.mediaCount}(${userInfo.media.count}) 媒体在本地存在`);

    if (userInfo.media.edges.length > 0) {
      logger(`用户：${userInfo.userName} 的媒体资源 node 正在下载中… 请等待…`);
      await downMediaList(userInfo);
    }
    logger(`用户：${userInfo.userName}  ( 已下载： ${userInfo.downs} | 未下载： ${userInfo.miss} | 下载： ${userInfo.exists} ) media\n`);
    allDowns += userInfo.downs;
    allMiss += userInfo.miss;
    allExists += userInfo.exists;
  }

  logger(` ${downUsers.length} users ( 已下载： ${allDowns} | 未下载： ${allMiss} | 下载： ${allExists} )\n`);
})();

function getFollowUsers(user) {
  let first = true;
  return new Promise((resolve /* , reject */ ) => {
    let retryNum = 0;
    let rGetFollowUsers = () => {
      r.get(`${hostUrl}/${user}/`, (err, resp) => {
        try {
          if (err) {
            throw `http error: ${err}`;
          }

          let $ = cheerio.load(resp.body);
          $('script').each((index, element) => {
            if ($(element).text() && /^window\._sharedData = (\{.*\});$/.test($(element).text())) {
              let onePageNodes = 50,
                query_hash = 'c56ee0ae1f89cdbd1c89e2bc6b8f3d18',
                variables = {
                  id: JSON.parse(RegExp.$1).entry_data.ProfilePage[0].graphql.user.id,
                  first: onePageNodes,
                };

              r.get({
                url: `${hostUrl}/graphql/query/`,
                qs: {
                  query_hash: query_hash,
                  variables: JSON.stringify(variables),
                  include_reel: true,
                  fetch_mutual: false,
                },
              }, (err, resp) => {
                let userList = [];
                JSON.parse(resp.body).data.user.edge_follow.edges.forEach((edge) => {
                  userList.push(edge.node.username);
                });

                resolve(userList);
              });
            }
          });
        } catch (error) {
          if (first) {
            first = false;
            setTimeout(rGetFollowUsers, 30 * 1000);
          } else {
            retryNum++;
            if (retryNum < RETRYMAXNUM) {
              rGetFollowUsers();
            } else {
              logger();
              logger(`获取 ${user} 用户信息失败: ${error}`);
              logger();
              process.exit();
            }
          }
        }
      });
    };
    rGetFollowUsers();
  });
}

function getUserInfo(userName) {
  return new Promise((resolve /* , reject */ ) => {
    let retryNum = 0;
    let rGetDownUserInfo = () => {
      r.get(`${hostUrl}/${userName}/`, (err, resp) => {
        try {
          if (err) {
            throw `http error: ${err}`;
          }

          let $ = cheerio.load(resp.body);

          let userInfo = {
            id: '',
            media: undefined,
          };
          $('script').each((index, element) => {
            if ($(element).text() && /^window\._sharedData = (\{.*\});$/.test($(element).text())) {
              let downUserInfo = JSON.parse(RegExp.$1);
              if (downUserInfo.entry_data.ProfilePage) {
                userInfo.id = downUserInfo.entry_data.ProfilePage[0].graphql.user.id;
                userInfo.media = downUserInfo.entry_data.ProfilePage[0].graphql.user.edge_owner_to_timeline_media;
              }
            }
          });
          resolve(userInfo);
        } catch (error) {
          retryNum++;
          if (retryNum < RETRYMAXNUM) {
            rGetDownUserInfo();
          } else {
            logger();
            logger(`获取 ${userName} 用户信息失败: ${error}`);
            logger();
            process.exit();
          }
        }
      });
    };
    rGetDownUserInfo();
  });
}

function getUserAllMediaNode(userInfo) {
  return new Promise(async (resolve /* , reject */ ) => {
    let lastID = userInfo.media.edges.slice(-1)[0].node.id;
    while (
      userInfo.media.page_info.has_next_page &&
      userInfo.localNodes[lastID] === undefined &&
      userInfo.localSidecars[lastID] === undefined
    ) {
      await getMorePageMediaNode(userInfo);
      logger(`用户：${userInfo.userName}  获取媒体列表中 node:${userInfo.media.edges.length}/${userInfo.media.count} success`, true);
      lastID = userInfo.media.edges.slice(-1)[0].node.id;
    }

    userInfo.getSidecars = [];
    userInfo.media.edges.forEach((edge) => {
      if (userInfo.localNodes[edge.node.id] === undefined && userInfo.localSidecars[edge.node.id] === undefined) {
        if (edge.node.__typename === 'GraphSidecar') {
          userInfo.getSidecars.push(edge.node);
        } else {
          let caption = edge.node.edge_media_to_caption.edges
          let mediaNode = {
            __typename: edge.node.__typename,
            is_video: edge.node.is_video,
            id: edge.node.id,
            code: edge.node.shortcode,
            date: edge.node.taken_at_timestamp,
            display_url: edge.node.display_url,
            content: caption.length ? caption[0].node.text : '',
          };
          mediaNode.mediaName = new Date(mediaNode.date * 1000).Format('yyyy.MM.dd - HH.mm.ss') + ' - ' + mediaNode.id;

          userInfo.localNodes[mediaNode.id] = mediaNode;
          userInfo.localNodes.len++;
        }
      }
    });
    userInfo.media.edges = [];

    resolve();
  });
}

function getMorePageMediaNode(userInfo) {
  return new Promise((resolve /* , reject */ ) => {
    let onePageNodes = 12,
      query_hash = '472f257a40c653c64c666ce877d59d2b',
      variables = {
        id: userInfo.id,
        first: onePageNodes,
        after: userInfo.media.page_info.end_cursor,
      };

    let retryNum = 0;
    let rGetMediaNodeList = () => {
      r.get({
        url: `${hostUrl}/graphql/query/`,
        qs: {
          query_hash: query_hash,
          variables: JSON.stringify(variables),
        },
        headers: {
          'Accept': '*/*',
          // 'X-CSRFToken': csrfToken,
          'Referer': hostUrl + '/' + userInfo.userName + '/',
        },
      }, (err, resp) => {
        try {
          if (err) {
            throw `http error: ${err}`;
          }

          let nextData = JSON.parse(resp.body);
          nextData.data.user.edge_owner_to_timeline_media.edges.forEach((edge) => {
            userInfo.media.edges.push(edge);
          });
          userInfo.media.page_info = nextData.data.user.edge_owner_to_timeline_media.page_info;

          resolve();
        } catch (error) {
          retryNum++;
          if (retryNum < RETRYMAXNUM) {
            rGetMediaNodeList();
          } else {
            logger();
            logger(`获取 ${userInfo.userName} 媒体列表失败: ${error}`);
            logger();
            logger('等待2分钟重试');
            setTimeout(rGetMediaNodeList, 2 * 60 * 1000);
          }
        }
      });
    };
    rGetMediaNodeList();
  });
}

function getSidecarsInfo(userInfo) {
  return new Promise((resolve /* , reject */ ) => {
    mapLimit(userInfo.getSidecars, config.maxMediaOccurs, (sidecarItem, callback) => {
      let sidecarNode = {
        __typename: sidecarItem.__typename,
        is_video: sidecarItem.is_video,
        id: sidecarItem.id,
        code: sidecarItem.shortcode,
        date: sidecarItem.taken_at_timestamp,
        display_url: sidecarItem.display_url,
        childNodeID: [],
      };

      let retryNum = 0;
      let rGetSidecar = () => {
        let sidecarUrl = `${hostUrl}/p/${sidecarNode.code}/?__a=1`;
        r.get(sidecarUrl, (err, resp) => {
          try {
            if (err) {
              throw `http error: ${err}`;
            }

            let sidecarJson = JSON.parse(resp.body);

            let childNodes = [];
            sidecarJson.graphql.shortcode_media.edge_sidecar_to_children.edges.forEach((edge) => {
              edge.node.taken_at_timestamp = sidecarNode.date;
              childNodes.push(edge.node);

              sidecarNode.childNodeID.push(edge.node.id);
            });

            userInfo.localSidecars[sidecarNode.id] = sidecarNode;
            userInfo.localSidecars.len++;

            callback(null, childNodes);
          } catch (error) {
            retryNum++;
            if (retryNum < RETRYMAXNUM) {
              rGetSidecar();
            } else {
              logger();
              logger(`get ${userInfo.userName} Sidecar ${sidecarNode.code} info fail: ${error}`);
              logger();
              process.exit();
            }
          }
        });
      };
      rGetSidecar();
    }, (errs, result) => {
      result.forEach((childNodes) => {
        childNodes.forEach((node) => {
          let mediaNode = {
            __typename: node.__typename,
            is_video: node.is_video,
            id: node.id,
            code: node.shortcode,
            date: node.taken_at_timestamp,
            display_url: node.display_url,
          };
          mediaNode.mediaName = new Date(mediaNode.date * 1000).Format('yyyy.MM.dd - HH.mm.ss') + ' - ' + mediaNode.id;

          if (userInfo.localNodes[mediaNode.id] === undefined) {
            userInfo.localNodes[mediaNode.id] = mediaNode;
            userInfo.localNodes.len++;
          }
        });
      });

      resolve();
    });
  });
}

function readAndExistsFiles(userInfo) {
  fs.readdirSync(userInfo.savePath).forEach((fileName /* , index, array */ ) => {
    let fileStat = fs.statSync(path.join(userInfo.savePath, fileName));
    if (fileStat.isFile()) {
      if (fileName.slice(-4) === '.tmp') {
        fs.unlinkSync(path.join(userInfo.savePath, fileName));
      } else {
        for (let i = 0; i < userInfo.media.edges.length; i++) {
          if (fileName.includes(userInfo.media.edges[i].mediaName)) {
            userInfo.exists++;
            userInfo.media.edges.splice(i, 1);
            i--;
          }
        }
      }
    }
  });
}


function downMediaList(userInfo) {
  return new Promise((resolve /* , reject */ ) => {
    let mediaNodeList = userInfo.media.edges;
    let donwNum = 0;
    mapLimit(mediaNodeList, config.maxMediaOccurs, (mediaNodeInfo, callback) => {
      (async () => {
        let mediaSrc;
        if (mediaNodeInfo.is_video) {
          mediaSrc = await getVideoInfo(mediaNodeInfo);
        } else {
          mediaSrc = mediaNodeInfo.display_url;
        }

        let mediaExt = mediaSrc.replace(/\?.*$/, '').replace(/^.*\./, '');

        let mediaPath = path.join(userInfo.savePath, mediaNodeInfo.mediaName + '.' + mediaExt);

        let downFlag = await downTheMedia(mediaSrc, mediaPath);
        donwNum++;
        if (downFlag) {
          logger(`用户：${userInfo.userName}  下载成功 (${donwNum}/${mediaNodeList.length}) ${mediaNodeInfo.mediaName}`, true);
          userInfo.downs++;
        } else {
          logger(`\n  用户：${userInfo.userName}  下载失败 (${donwNum}/${mediaNodeList.length})  ${mediaNodeInfo.mediaName}\n`);
          userInfo.miss++;
        }
        callback(null);
      })();
    }, () => {
      resolve();
    });
  });
}

function getVideoInfo(mediaNodeInfo) {
  return new Promise((resolve /* , reject */ ) => {
    let retryNum = 0;
    let rGetVideoInfo = () => {
      let videoJsonUrl = `${hostUrl}/p/${mediaNodeInfo.code}/?__a=1`;
      r.get(videoJsonUrl, (err, resp) => {
        try {
          if (err) {
            throw `http error: ${err}`;
          }

          let mediaSrc;
          if (resp.request.href === videoJsonUrl) {
            mediaSrc = JSON.parse(resp.body).graphql.shortcode_media.video_url;
          } else {
            let $ = cheerio.load(resp.body);
            $('script').each((index, element) => {
              if ($(element).text() && /^window\._sharedData = (\{.*\});$/.test($(element).text())) {
                let videoInfo = JSON.parse(RegExp.$1);
                videoInfo.entry_data.PostPage[0].graphql.shortcode_media.edge_sidecar_to_children.edges.forEach((edge) => {
                  if (edge.node.id === mediaNodeInfo.id) {
                    mediaSrc = edge.node.video_url;
                  }
                });
              }
            });
          }
          if (!mediaSrc) {
            throw 'mediaSrc not get';
          }
          resolve(mediaSrc);
        } catch (error) {
          retryNum++;
          if (retryNum < RETRYMAXNUM) {
            rGetVideoInfo();
          } else {
            logger();
            logger(`get video ${mediaNodeInfo.code} info fail: ${error}`);
            logger();
            process.exit();
          }
        }
      });
    };
    rGetVideoInfo();
  });
}

function downTheMedia(mediaSrc, mediaPath) {
  return new Promise((resolve /* , reject */ ) => {
    let retryNum = 0;
    let rDownTheMedia = () => {
      let errorFalg = undefined;

      let errHandle = (error) => {
        if (!errorFalg) {
          errorFalg = error;
          rStream.end();
          wStream.end();
        }
      };

      let rStream = r.get({
        url: mediaSrc,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_3) AppleWebKit/537.36(KHTML, like Gecko) Chrome/65.0.3325.146 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Charset': 'UTF-8,*;q=0.5',
          'Accept-Encoding': 'gzip,deflate,sdch',
          'Accept-Language': 'en-US,en;q=0.8',
          // 'Referer': rootUrl,
        },
        timeout: 30 * 1000,
      });
      let wStream = fs.createWriteStream(mediaPath + '.tmp');

      rStream.pipe(wStream)
        .on('finish', () => {
          if (errorFalg === undefined) {
            fs.renameSync(mediaPath + '.tmp', mediaPath);
            resolve(true);
          } else {
            if (fs.existsSync(mediaPath + '.tmp')) {
              fs.unlinkSync(mediaPath + '.tmp');
            }
            retryNum++;
            if (retryNum < RETRYMAXNUM) {
              setTimeout(rDownTheMedia, 3 * 1000);
            } else {
              logger();
              logger(`  error down ${mediaPath} :\n    ${errorFalg}`);
              logger();
              resolve(false);
            }
          }
        });

      rStream.on('error', errHandle);
      wStream.on('error', errHandle);
    };
    rDownTheMedia();
  });
}
