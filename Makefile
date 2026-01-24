CC = gcc
CFLAGS = -Wall -Wextra -pedantic -std=c99 -D_POSIX_C_SOURCE=200809L -D_DEFAULT_SOURCE -D_DARWIN_C_SOURCE
CFLAGS += $(shell pkg-config --cflags libcurl libarchive 2>/dev/null)
LDFLAGS = $(shell pkg-config --libs libcurl libarchive 2>/dev/null || echo "-lcurl -larchive")

PREFIX ?= /usr/local
DESTDIR ?=

SRC_DIR = src
BUILD_DIR = build

SRCS = $(wildcard $(SRC_DIR)/*.c)
OBJS = $(SRCS:$(SRC_DIR)/%.c=$(BUILD_DIR)/%.o)

TARGET = rosie

# Debug build by default
CFLAGS += -g -O0

.PHONY: all clean release install uninstall

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(OBJS) -o $@ $(LDFLAGS)

$(BUILD_DIR)/%.o: $(SRC_DIR)/%.c | $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

release: CFLAGS = -Wall -Wextra -pedantic -std=c99 -D_POSIX_C_SOURCE=200809L -D_DEFAULT_SOURCE -D_DARWIN_C_SOURCE -O2 $(shell pkg-config --cflags libcurl libarchive 2>/dev/null)
release: clean $(TARGET)

clean:
	rm -rf $(BUILD_DIR) $(TARGET)

install: $(TARGET)
	install -d $(DESTDIR)$(PREFIX)/bin
	install -m 755 $(TARGET) $(DESTDIR)$(PREFIX)/bin/

uninstall:
	rm -f $(DESTDIR)$(PREFIX)/bin/$(TARGET)

# Dependencies (auto-generated would be better, but this works)
$(BUILD_DIR)/main.o: $(SRC_DIR)/main.c $(SRC_DIR)/install.h $(SRC_DIR)/agent.h $(SRC_DIR)/util.h
$(BUILD_DIR)/install.o: $(SRC_DIR)/install.c $(SRC_DIR)/install.h $(SRC_DIR)/download.h $(SRC_DIR)/archive.h $(SRC_DIR)/skill.h $(SRC_DIR)/agent.h $(SRC_DIR)/util.h
$(BUILD_DIR)/download.o: $(SRC_DIR)/download.c $(SRC_DIR)/download.h $(SRC_DIR)/util.h
$(BUILD_DIR)/archive.o: $(SRC_DIR)/archive.c $(SRC_DIR)/archive.h $(SRC_DIR)/util.h
$(BUILD_DIR)/skill.o: $(SRC_DIR)/skill.c $(SRC_DIR)/skill.h $(SRC_DIR)/util.h
$(BUILD_DIR)/agent.o: $(SRC_DIR)/agent.c $(SRC_DIR)/agent.h $(SRC_DIR)/util.h
$(BUILD_DIR)/util.o: $(SRC_DIR)/util.c $(SRC_DIR)/util.h
