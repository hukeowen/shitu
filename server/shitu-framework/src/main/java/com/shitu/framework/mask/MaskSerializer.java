package com.shitu.framework.mask;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.BeanProperty;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.databind.ser.ContextualSerializer;
import com.shitu.common.enums.ActorRole;

import java.io.IOException;
import java.util.Arrays;
import java.util.Set;

public class MaskSerializer extends JsonSerializer<String> implements ContextualSerializer {
    private final MaskType type;
    private final Set<ActorRole> visibleTo;

    public MaskSerializer() {
        this(null, Set.of());
    }

    private MaskSerializer(MaskType type, Set<ActorRole> visibleTo) {
        this.type = type;
        this.visibleTo = visibleTo;
    }

    @Override
    public JsonSerializer<?> createContextual(SerializerProvider prov, BeanProperty property) {
        Mask mask = property == null ? null : property.getAnnotation(Mask.class);
        if (mask == null) {
            return this;
        }
        return new MaskSerializer(mask.type(), Set.copyOf(Arrays.asList(mask.visibleTo())));
    }

    @Override
    public void serialize(String value, JsonGenerator gen, SerializerProvider serializers) throws IOException {
        if (value == null) {
            gen.writeNull();
            return;
        }
        boolean plain = type == null || ViewerContext.roles().stream().anyMatch(visibleTo::contains);
        gen.writeString(plain ? value : type.apply(value));
    }
}
