import hashlib
import random
import redis
import string

def generate_salt():
    return hashlib.sha1(str(random.random())).hexdigest()

def generate_room():
    room = hashlib.md5(str(random.random())).hexdigest()[0:12]
    while redis.conn.sismember('rooms', room):
        room = hashlib.md5(str(random.random())).hexdigest()[0:12]
    return room

def create_token():
    token = generate_salt()
    while redis.conn.sismember('tokens', token):
        token = generate_salt()
    redis.conn.sadd('tokens', token)
    return token

def claim_token(token):
    if not token or not redis.conn.srem('tokens', token):
        return False
    return True

def make_random_user():
    hasher = hashlib.md5()
    hasher.update(''.join([random.choice(string.letters) for i in range(10)]))
    name = hasher.hexdigest()
    user = User(name)
    user.create('lolwut')
    return user

class User(object):
    def __init__(self, email):
        self.email = email

    @staticmethod
    def get_all_users():
        users = redis.conn.smembers('users')
        user_set = set()
        for user in users:
            user_set.add(User(user))
        return user_set

    @property
    def name(self):
        if not hasattr(self, '_name'):
            self._name = redis.conn.get(self.get_hash('name'))
        return self._name

    @property
    def token(self):
        return self.get_from_redis('token')

    def create(self, password, token=None):
        if token == None:
            token = create_token()
            self.set_in_redis("token", token)
        if not self.email or not password or not claim_token(token) or self.exists():
            return False
        self.set_in_redis("name", self.email)
        self.set_password(password)
        self.add_role("guest")
        redis.conn.sadd('users', self.email)
        return self

    def destroy(self):
        redis.conn.delete(self.get_hash('name'))
        redis.conn.delete(self.get_hash('password'))
        redis.conn.delete(self.get_hash('salt'))
        redis.conn.delete(self.get_hash('token'))
        redis.conn.delete(self.get_hash('roles'))
        redis.conn.srem('users', self.email)

    def exists(self):
        return redis.conn.sismember('users', self.email)

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

    def update(self, **kwargs):
        for key in kwargs:
            if kwargs[key]:
                self.set_in_redis(key, kwargs[key])

    def salt_password(self, salt, password):
        hash_me = salt + password
        for i in range(100):
            hash_me = hashlib.sha1(hash_me).hexdigest()
        return hash_me

    def authenticate(self, password):
        if self.exists() and self.salt_password(self.get_from_redis("salt"), password) == self.get_from_redis("password"):
            return True
        else:
            return False

    def auth_with_token(self, token, generate_new_token=True):
        if token == self.get_from_redis("token"):
            if generate_new_token:
                token = generate_salt()
                self.set_in_redis("token", token)
            return token
        else:
            return False

    def auth_keep_token(self, token):
        #print('%s == %s' % (token, self.get_from_redis('token')))
        if token == self.get_from_redis("token"):
            return token
        else:
            return False

    def auth_for_token(self, password):
        if self.authenticate(password):
            token = generate_salt()
            self.set_in_redis("token", token)
            return token
        else:
            return False

    def set_password(self, password):
        salt = generate_salt()
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

class AuthenticationHandlerMixin(object):
    """
    By inheriting from RequestHandler, we can apply this AuthenticationHandler to both regular
    RequestHandlers and WebsocketRequestHandlers
    """

    def __init__(self, *args, **kwargs):
        super(AuthenticationHandlerMixin, self).__init__(*args, **kwargs)

    def get_current_user(self):
        """
        has to handle cases where the secure cookie cannot be written to, ie websockets
        """

        def set_secure_cookie(key, val):
            try:
                self.set_secure_cookie(key, val)
            except Exception, e:
                print e

        u = self.get_secure_cookie('user_email')
        user =  User(self.get_secure_cookie('user_email'))
        t = self.get_secure_cookie('user_token')
        print "======================>", u, t, user
        token = user.auth_keep_token(self.get_secure_cookie('user_token'))
        if token:
            return user
        else:
            print "user token is weird, making new user"
            user = make_random_user()
            set_secure_cookie('user_token', user.token)
            set_secure_cookie('user_email', user.email)

            print "======================>", user.email, user.token, user
            return user

    def has_role(self, role):
        return self.current_user.has_role(role)
