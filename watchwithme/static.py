import watchwithme.user as user

class FrontPageHandler(user.AuthenticationHandler):
    def get(self):
        self.render("views/home.html")

    def render(self, template_name, **kwargs):
        kwargs['current_user'] = kwargs.get('current_user', self.current_user)
        if self.current_user:
            kwargs['is_admin'] = kwargs.get('is_admin', self.current_user.has_role('admin'))
            kwargs['is_host'] = kwargs.get('is_host', self.current_user.has_role('host'))
            kwargs['is_guest'] = kwargs.get('is_guest', self.current_user.has_role('guest'))
        super(FrontPageHandler, self).render(template_name, **kwargs)
