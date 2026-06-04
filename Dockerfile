FROM fedora:44

RUN dnf install -y \
        glib2-devel \
        nodejs \
        zip \
        ShellCheck \
    && dnf clean all

WORKDIR /build
