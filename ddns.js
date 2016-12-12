const debug = require('debug')('ddns')
const apiBaseUrl = 'https://dnsapi.cn/'
const request = require('request')
const async = require('async')
const EventEmitter = require('events')
const logger = require('winston')
const apiUrl = {}
apiUrl.domain = {}
apiUrl.domain.list = apiBaseUrl + 'domain.list'
apiUrl.record = {}
apiUrl.record.list = apiBaseUrl + 'record.list'
apiUrl.record.modify = apiBaseUrl + 'record.modify'
apiUrl.record.ddns = apiBaseUrl + 'record.ddns'

const ONE_HOUR = 60 * 60 * 1000


class Ddns extends EventEmitter {
  constructor(options, publicIp) {
    super()
    this.publicIp = publicIp
    this.options = {
      format: 'json',
    }
    this.domainName = options.domainName
    this.subDomain = options.subDomain
    this.ipQueryUrl = options.queryUrl
    this.recordLine = options.recordLine || '默认'
    if (options.loginToken) {
      this.options.login_token = options.loginToken
    } else {
      this.options.login_email = options.email
      this.options.login_password = options.pass
    }

  }
  refresh() {
    const self = this
    async.waterfall([
      function getPublicIp(cb) {
        request.get(self.ipQueryUrl, wrapResponse('plain/text', function (err, ip) {
          if (err || !isIPAddress(ip.replace('\n', ''))) {
            self.emit('failure', (err || 'Incorrect IP address:' + ip))
            return cb(err || 'Incorrect IP address:' + ip)
          }
          self.emit('success', ip)
          if (ip === self.publicIp && (Date.now() - self.lastUpdate) < ONE_HOUR) {
            cb({
              cancel: true,
            })
          } else {
            self.publicIp = ip
            cb()
          }
        }))
      },
      function getDomainId(cb) {
        const opt = Object.assign({}, self.options)
        opt.keyword = self.domainName
        request.post(apiUrl.domain.list, {
          form: opt,
        }, wrapResponse(function (err, res) {
          if (err) {
            return cb(err)
          }
          const domain = res.domains[0]
          if (domain.name != self.domainName) {
            cb('Incorrect domain name:' + domain.name)
          } else {
            cb(null, domain.id)
          }
        }))
      },
      function getRecordId(domainId, cb) {
        debug('getRecordId:' + domainId)
        const opt = Object.assign({}, self.options)
        opt.domain_id = domainId
        opt.sub_domain = self.subDomain
        request.post(apiUrl.record.list, {
          form: opt,
        }, wrapResponse(function (err, res) {
          if (err) {
            return cb(err)
          }
          const records = res.records
          const record = records.find(function (record) {
            return record.type === 'A'
          })
          if (!record) {
            cb('No record found for sub domain:' + self.subDomain)
          } else {
            if (record.value === self.publicIp) return cb({
              cancel: true,
            })
            cb(null, domainId, record.id)
          }
        }))
      },
      function updateDdns(domainId, recordId, cb) {
        const opt = Object.assign({}, self.options)
        opt.domain_id = domainId
        opt.record_id = recordId
        opt.value = self.publicIp
        opt.record_line = self.recordLine
        opt.sub_domain = self.subDomain
        request.post(apiUrl.record.ddns, {
          form: opt,
        }, wrapResponse(cb))
      },
    ], function (err) {
      if (err) {
        if (err.cancel) {
          debug('Updating cancelled.')
        } else {
          debug(err)
          logger.error(err)
          throw err
        }
      } else {
        self.lastUpdate = Date.now()
        debug('Update successfully.')
      }
    })
  }
}


function wrapResponse(format, callback) {
  if (typeof format === 'function') {
    callback = format
    format = 'json'
  }
  return function (err, res, body) {
    if (err || res.statusCode != 200) {
      err = err || new Error('Error Code:' + res.statusCode + '\n' + body)
      return callback(err)
    }
    if (format === 'json') {
      var json
      try {
        json = JSON.parse(body)
      } catch (e) {
        return callback(e)
      }
      if (json.status.code != '1') {
        callback(body)
      } else {
        callback(null, json)
      }

    } else {
      callback(null, body)
    }

  }
}

function isIPAddress(str) {
  str = str ? str.trim() : ''
  const regex = /^(\d+\.){3}\d+$/
  return regex.test(str)
}


module.exports = Ddns
