import redis
import tornado.websocket
import threading
from hashlib import sha1

redis.conn = redis.StrictRedis(host='localhost', port=6379, db=0)

class Room(object):
    def __init__(self, room_id):
        self.id = room_id

    def get_users_hash(self):
        return "room:%s:users" % self.id

    def get_rooms_hash(self):
        return "rooms"

    def exists(self):
        if redis.conn.zscore(self.get_rooms_hash(), self.id):
            return True
        else:
            return False

    def get_size(self):
        return redis.conn.zscore(self.get_rooms_hash(), self.id)

    def create(self):
        redis.conn.zadd(self.get_rooms_hash(), 0, self.id)
        return self

    def destroy(self):
        redis.conn.zrem(self.get_rooms_hash(), self.id)
        return self

    def join(self, user):
        if redis.conn.sadd(self.get_users_hash(), user.email):
            redis.conn.zincrby(self.get_rooms_hash(), 1, self.id)
            return True
        else:
            return False

    def leave(self, user):
        if redis.conn.srem(self.get_users_hash(), user.email):
            redis.conn.zincrby(self.get_rooms_hash(), -1, self.id)
            return True
        else:
            return False


class RedisListener(threading.Thread):
    def __init__(self, room, socket):
        self.room = room
        self.socket = socket
        self.time_to_die = threading.Event()
        super(RedisListener, self).__init__()
        
    def run(self):
        self.subscription = redis.conn.pubsub()
	self.subscription.subscribe("room:%s" % self.room.id)
        for message in self.subscription.listen():
            if self.time_to_die.isSet():
                break
            self.socket.write_message(message['data'])

    def stop(self):
        self.time_to_die.set()

class User(object):
    def __init__(self, email):
        self.email = email

    def get_hash(self, value):
        return "user:%s:%s" % (self.email, value)

    def get_from_redis(self, value):
        if value == "roles":
            return redis.conn.smembers(self.get_hash(value))
        else:
            return redis.conn.get(self.get_hash(value))

    def set_in_redis(self, value, set_to):
        if value == "roles":
            redis.conn.delete(self.get_hash(value))
            for role in set_to:
                redis.conn.sadd(self.get_hash(value), role)
        else:
            redis.conn.set(self.get_hash(value), set_to)
        return self

    def salt_password(self, salt, password):
        hash_me = salt + password
        for i in range(100):
            hash_me = sha1(hash_me)
        return hash_me

    def generate_salt(self):
        from random import random
        return sha1(random())

    def authenticate(self, password):
        if self.salt_password(self.get_from_redis("salt"), password) == self.get_from_redis("password"):
            return True
        else:
            return False

    def auth_with_token(self, token):
        if token == self.get_from_redis("token"):
            token = self.generate_salt()
            self.set_in_redis("token", token)
            return token
        else:
            return False

    def auth_for_token(self, password):
        if self.authenticate(password):
            token = self.generate_salt()
            self.set_in_redis("token", token)
            return token
        else:
            return False

    def create(self, name, password):
        self.set_in_redis("name", name)
        self.set_password(password)
        self.add_role("guest")
        self.set_in_redis("token", self.generate_salt())
        return self

    def set_password(self, password):
        salt = self.generate_salt()
        self.set_in_redis("salt", salt)
        self.set_in_redis("password", self.salt_password(salt, password))
        return self
        
    def add_role(self, role):
        redis.conn.sadd(self.get_hash("roles"), role)
        return self

    def remove_role(self, role):
        redis.conn.srem(self.get_hash("roles"), role)
        return self

    def has_role(self, role):
        return redis.conn.sismember(self.get_hash("roles"), role)

