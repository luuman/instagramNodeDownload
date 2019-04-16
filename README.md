# instagramNodeDownload

## 简介
本项目使用NodeJS实现，对instagram媒体资源进行批量下载。老婆想要看ins里面的图片。

## 前期配置

### 使用shadowsocks科学上网
下载最新 shadowsocksX-NG

### HTTP代理
开启HTTP代理服务器

HTTP代理监听地址：127.0.0.1
HTTP代理监听端口：1087

proxy: 'http://127.0.0.1:1087',

## 使用方法

### 1. 安装依赖
```
npm install
```

### 2. 开始下载...
#### 模式1 :

配置 ```config.js``` 文件的 ```downUsers``` 字段(列表形式), 直接运行

```
node index.js
```

#### 模式2 :

```
node index.js luumans test1
```