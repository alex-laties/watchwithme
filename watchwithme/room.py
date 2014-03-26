import json
import redis
import threading
import time
import tornado, tornado.websocket
import watchwithme.user as user

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
            try:
                self.socket.write_message(message['data'])
            except:
                print message, 'was badly formatted'

    def stop(self):
        self.time_to_die.set()

class Room(object):
    def __init__(self, room_id):
        self.id = room_id

    def get_users_hash(self):
        return "room:%s:users" % self.id

    def get_rooms_hash(self):
        return "rooms"

    def get_room_timecodes_hash(self):
        return 'rooms:timecodes'

    @property
    def timecode(self):
        return redis.conn.zscore(self.get_room_timecodes_hash(), self.id)

    @timecode.setter
    def timecode(self, value):
        redis.conn.zadd(self.get_room_timecodes_hash(), self.id, value)

    @property
    def host(self):
        return redis.conn.get('room:%s:host' % self.id)

    @host.setter
    def host(self, val):
        redis.conn.set('room:%s:host' % self.id, val)

    def get_video_id(self):
        return redis.conn.get('room:%s:video_id' % self.id)

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
            redis.conn.zincrby(self.get_rooms_hash(), self.id, 1)
            print user.email, self.host, type(self.host)
            if self.host == 'None' or self.host == None:
                print '%s is now host of room %s' % (user.email, self.id)
                self.host = user.email
            return True
        else:
            print 'join failed'
            return False

    def leave(self, user):
        if redis.conn.srem(self.get_users_hash(), user.email):
            redis.conn.zincrby(self.get_rooms_hash(), self.id, -1)
            #unset host if necessary
            if self.host == user.email:
                self.host = None
            return True
        else:
            return False

class RoomSocketHandler(tornado.websocket.WebSocketHandler, user.AuthenticationHandlerMixin):
    """
    handles WS room connections
    """

    def get_current_user(self):
        return user.AuthenticationHandlerMixin.get_current_user(self)

    def open(self, room_id):
        print('room_id: %s' % room_id)
        self.room = Room(room_id)
        self.user = self.get_current_user()
        self.subscription = None
        if self.user:
            self.room.join(self.user)

    def on_message(self, data):

        data = json.loads(data)
        if not self.user:
            # make name
            print "==========================***", "user is weird, making new one"
            self.user = user.make_random_user()
            self.room.join(self.user)

        if not self.subscription:
            self.subscription = RedisListener(self.room, self)
            self.subscription.start()
            self.log_and_publish(construct_message('JOIN', 'Welcome!', self.user))


        #handle ping
        if data.get('type') == 'PING':
                self.write_message(
                    construct_wire_data('PONG', {'id': data.get('id')}).get('display')
                )
                return

        is_host = self.user.email == self.room.host

        if data.get('type') == 'SET_SOURCE' and \
            not is_host:
            print 'User tried to set source', self.user.email, self.room.host
            return
        if data.get('type') == 'TIMESTAMP':
            if not is_host:
                return #we don't care about this user's timestamp
            self.log_and_publish(construct_wire_data('TIMESTAMP', {'time': data.get('time'), 'ping': data.get('ping')}))
            return

        self.log_and_publish(construct_message(data.get('type'), data.get('message'), self.user))

    def on_close(self):
        print("socket closed")
        if self.subscription:
            self.subscription.stop()
            self.log_and_publish(construct_message('LEAVE', 'Goodbye.', self.user))
        self.room.leave(self.user)

    def log_and_publish(self, message):
        print(message.get('log'))
        redis.conn.rpush("room:%s:logs" % self.room.id, message.get('log'))
        redis.conn.publish("room:%s" % self.room.id, message.get('display'))

class SimpleRoomHandler(user.AuthenticationHandlerMixin, tornado.web.RequestHandler):
    """
    handles HTTP room connections
    """

    def get(self, room_id):
        room = Room(room_id)
        if not room.exists():
            room.create()
        self.render("views/room.html",
                    video_url='',
                    room_id=room_id)

    def render(self, template_name, **kwargs):
        kwargs['current_user'] = kwargs.get('current_user', self.current_user)
        if self.current_user:
            kwargs['is_admin'] = kwargs.get('is_admin', self.current_user.has_role('admin'))
            kwargs['is_host'] = kwargs.get('is_host', self.current_user.has_role('host'))
            kwargs['is_guest'] = kwargs.get('is_guest', self.current_user.has_role('guest'))
        super(SimpleRoomHandler, self).render(template_name, **kwargs)

def construct_message(type, message, user=None, timestamp=None):
    return construct_wire_data(type, {'message':message}, user, timestamp)

def construct_wire_data(type, data, user=None, timestamp=None):
    if not timestamp:
        timestamp = time.time()
    log_object = {
        'type' : type,
        'user' : getattr(user, 'email', None),
        'time' : timestamp,
        'data' : data,
    }
    display_object = {
        'type' : log_object.get('type'),
        'user' : getattr(user, 'name', None),
        'time' : log_object.get('time'),
        'data' : log_object.get('data'),
    }
    return {
        'log' : json.dumps(log_object),
        'display' : json.dumps(display_object),
    }
