import config
import watchwithme.room
import watchwithme.static

URLS = [
    (r"^/$", watchwithme.static.FrontPageHandler),
    (r"^/room/([\w\d]+)/socket/?$", watchwithme.room.RoomSocketHandler),
    (r"^/simpleroom/([\w\d]+)/?$", watchwithme.room.SimpleRoomHandler),
]
