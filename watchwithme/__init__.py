import config, redis

redis.conn = redis.Redis(host=config.REDIS['host'], port=config.REDIS['port'], db=config.REDIS['db'])
